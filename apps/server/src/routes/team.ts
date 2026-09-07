/** Team endpoints (Bearer team token). */
import { Router, Request, Response, type RequestHandler } from 'express';
import { prisma as DB } from '../lib/prisma';
import { type Difficulty, DIFFICULTIES } from '@wcc/shared';
import { actionLimiter } from '../middleware/ratelimit';
import { requireAuth, requireTeam, type AuthedRequest } from '../auth/guard';
import { unauthorized } from '../lib/errors';
import { listMarketplace, purchaseQuestion, listOwnedQuestions } from '../domain/market';
import { submitAnswer } from '../domain/solve';
import { listTrades, proposeTrade, acceptTrade, rejectTrade, cancelTrade, listTradeTargets } from '../domain/trades';
import { toTeamSummary, currentSeq, toGameMeta } from '../domain/serializers';
import { getLeaderboard, getTransactions, getActivity } from '../domain/admin';
import {
  purchaseSchema,
  submitSchema,
  createTradeSchema,
  resolveTradeSchema,
} from '@wcc/shared';
import { validate } from '../middleware/validate';

export const teamRouter = Router();

/** Express 5 params can be `string | string[] | undefined`; all our params are single segments. */
const param = (req: Request, name: string): string => {
  const v = (req.params as Record<string, string | string[] | undefined>)[name];
  return Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
};

/** Wrap an AuthedRequest handler so it satisfies Express 5's contravariant RequestHandler typing.
 *  Deliver async rejections to the errorHandler (a bare `void fn(...)` leaks them as unhandled rejections). */
const h =
  (fn: (req: AuthedRequest, res: Response) => unknown): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req as AuthedRequest, res)).catch(next);
  };

teamRouter.use(async (req, res, next) => {
  await requireAuth(req as any, res, next, DB);
});
teamRouter.use(requireTeam);

teamRouter.get('/state', h(async (req: AuthedRequest, res: Response) => {
  const game = req.game;
  const team = req.team!;
  // req.team was authenticated by the guard against the presented token; refresh
  // it so coins/score/online reflect the latest committed state.
  const identity = await DB.team.findUnique({ where: { id: team.id } });
  if (!identity) throw unauthorized('Session invalid');

  const maxAttempts = (game.config as { maxAttempts?: number }).maxAttempts ?? 1;
  const [marketplace, inventory, trades, transactions, leaderboard, activity, seq] = await Promise.all([
    listMarketplace(DB, game, team.id, {}),
    listOwnedQuestions(DB, game, team.id, maxAttempts),
    listTrades(DB, game, team.id),
    getTransactions(DB, game, team.id),
    getLeaderboard(DB, game),
    getActivity(DB, game),
    currentSeq(DB, game.id),
  ]);
  const meta = toGameMeta(game, [], seq);
  return res.json({
    meta,
    team: toTeamSummary(identity),
    marketplace,
    inventory,
    trades,
    transactions,
    leaderboard,
    activity,
    lastEventSeq: seq,
  });
}));

teamRouter.get('/marketplace', h(async (req: AuthedRequest, res: Response) => {
  const { difficulty: d, category, sort } = req.query as Record<string, string | undefined>;
  const difficulty: Difficulty | undefined = d && (DIFFICULTIES as readonly string[]).includes(d) ? (d as Difficulty) : undefined;
  const items = await listMarketplace(DB, req.game, req.team!.id, { difficulty, category, sort: sort as any });
  res.json(items);
}));

teamRouter.post('/questions/:qid/purchase', actionLimiter, validate(purchaseSchema), h(async (req: AuthedRequest, res: Response) => {
  const { idempotencyKey } = req.body as { idempotencyKey: string };
  const result = await purchaseQuestion(DB, req.game, req.team!.id, param(req, 'qid'), idempotencyKey);
  if (result.ok && result.events.length) req.app.get('io')?.emitGameEvents(req.game.code, result.events);
  res.json(result);
}));

teamRouter.get('/inventory', h(async (req: AuthedRequest, res: Response) => {
  const maxAttempts = (req.game.config as any).maxAttempts ?? 1;
  const inv = await listOwnedQuestions(DB, req.game, req.team!.id, maxAttempts);
  res.json(inv);
}));

teamRouter.post('/questions/:qid/submit', actionLimiter, validate(submitSchema), h(async (req: AuthedRequest, res: Response) => {
  const { idempotencyKey, answer } = req.body as { idempotencyKey: string; answer: { kind: 'mcq'; selectedIndex: number } | { kind: 'free'; text: string } };
  const result = await submitAnswer(DB, req.game, req.team!.id, param(req, 'qid'), answer, idempotencyKey);
  if (result.events.length) req.app.get('io')?.emitGameEvents(req.game.code, result.events);
  res.json(result);
}));

teamRouter.get('/trades', h(async (req: AuthedRequest, res: Response) => {
  const trades = await listTrades(DB, req.game, req.team!.id);
  res.json(trades);
}));

teamRouter.get('/trades/targets', h(async (req: AuthedRequest, res: Response) => {
  const targets = await listTradeTargets(DB, req.game, req.team!.id);
  res.json(targets);
}));

teamRouter.post('/trades', actionLimiter, validate(createTradeSchema), h(async (req: AuthedRequest, res: Response) => {
  const { targetTeamId, offeredQuestionId, requestedQuestionId, coins, idempotencyKey } = req.body as { targetTeamId: string; offeredQuestionId: string; requestedQuestionId: string; coins: number; idempotencyKey: string };
  const result = await proposeTrade(DB, req.game, req.team!.id, { targetTeamId, offeredQuestionId, requestedQuestionId, coins, idempotencyKey });
  if (result.events.length) req.app.get('io')?.emitGameEvents(req.game.code, result.events);
  res.json(result);
}));

teamRouter.post('/trades/:tid/accept', actionLimiter, validate(resolveTradeSchema), h(async (req: AuthedRequest, res: Response) => {
  const { idempotencyKey } = req.body as { idempotencyKey: string };
  const result = await acceptTrade(DB, req.game, param(req, 'tid'), req.team!.id);
  if (result.events.length) req.app.get('io')?.emitGameEvents(req.game.code, result.events);
  res.json(result);
}));

teamRouter.post('/trades/:tid/reject', actionLimiter, validate(resolveTradeSchema), h(async (req: AuthedRequest, res: Response) => {
  const { idempotencyKey } = req.body as { idempotencyKey: string };
  const result = await rejectTrade(DB, req.game, param(req, 'tid'), req.team!.id);
  if (result.events.length) req.app.get('io')?.emitGameEvents(req.game.code, result.events);
  res.json(result);
}));

teamRouter.post('/trades/:tid/cancel', actionLimiter, validate(resolveTradeSchema), h(async (req: AuthedRequest, res: Response) => {
  const { idempotencyKey } = req.body as { idempotencyKey: string };
  const result = await cancelTrade(DB, req.game, param(req, 'tid'), req.team!.id);
  if (result.events.length) req.app.get('io')?.emitGameEvents(req.game.code, result.events);
  res.json(result);
}));

teamRouter.get('/transactions', h(async (req: AuthedRequest, res: Response) => {
  const txns = await getTransactions(DB, req.game, req.team!.id);
  res.json(txns);
}));

teamRouter.get('/leaderboard', h(async (req: AuthedRequest, res: Response) => {
  const lb = await getLeaderboard(DB, req.game);
  res.json(lb);
}));
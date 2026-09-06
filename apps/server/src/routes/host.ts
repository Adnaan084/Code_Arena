/** Host endpoints (Bearer host token). */
import { Router, Request, Response, type RequestHandler } from 'express';
import { prisma as DB } from '../lib/prisma';
import { actionLimiter, apiLimiter } from '../middleware/ratelimit';
import { requireAuth, requireHost, type AuthedRequest } from '../auth/guard';
import { startGame, pauseGame, resumeGame, closeMarket, finalizeGame, resetRound } from '../domain/games';
import { listQuestions, createQuestion, updateQuestion, deleteQuestion, toggleEnabled, importQuestions, exportQuestions } from '../domain/questions';
import { listTeams, disqualifyTeam, reinstateTeam, adjustCoins, refundPurchase, cancelTradeAdmin, createAnnouncement, getLeaderboard, getAuditLog, getTransactions, getActivity, updateConfig, forceCloseMarket } from '../domain/admin';
import { expireStaleTrades } from '../domain/trades';
import { currentSeq, toGameMeta } from '../domain/serializers';

export const hostRouter = Router();

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

hostRouter.use(async (req, res, next) => {
  await requireAuth(req as any, res, next, DB);
});
hostRouter.use(requireHost);

hostRouter.get('/state', h(async (req: AuthedRequest, res: Response) => {
  const game = req.game;
  const [teams, questions, activity, leaderboard, seq, transactions] = await Promise.all([
    listTeams(DB, game),
    listQuestions(DB, game),
    getActivity(DB, game),
    getLeaderboard(DB, game),
    currentSeq(DB, game.id),
    getTransactions(DB, game),
  ]);
  const meta = toGameMeta(game, [], seq);
  return res.json({ meta, teams, questions, activity, leaderboard, transactions, lastEventSeq: seq });
}));

hostRouter.post('/start', actionLimiter, h(async (req: AuthedRequest, res: Response) => {
  const { result, events } = await startGame(DB, req.game.id);
  req.app.get('io')?.emitGameEvents(events);
  res.json({ game: result, events });
}));

hostRouter.post('/pause', actionLimiter, h(async (req: AuthedRequest, res: Response) => {
  const { result, events } = await pauseGame(DB, req.game.id);
  req.app.get('io')?.emitGameEvents(events);
  res.json({ game: result, events });
}));

hostRouter.post('/resume', actionLimiter, h(async (req: AuthedRequest, res: Response) => {
  const { result, events } = await resumeGame(DB, req.game.id);
  req.app.get('io')?.emitGameEvents(events);
  res.json({ game: result, events });
}));

hostRouter.post('/close-market', actionLimiter, h(async (req: AuthedRequest, res: Response) => {
  const { result, events } = await closeMarket(DB, req.game.id);
  req.app.get('io')?.emitGameEvents(events);
  res.json({ game: result, events });
}));

hostRouter.post('/finalize', actionLimiter, h(async (req: AuthedRequest, res: Response) => {
  const { result, events } = await finalizeGame(DB, req.game.id);
  req.app.get('io')?.emitGameEvents(events);
  res.json({ game: result, events });
}));

hostRouter.post('/reset', actionLimiter, h(async (req: AuthedRequest, res: Response) => {
  const { reason } = req.body as { reason?: string };
  const { result } = await resetRound(DB, req.game.id);
  await import('../domain/feed').then(({ auditAction }) => auditAction(DB, req.game, 'ROUND_RESET', { reason: reason ?? null }));
  req.app.get('io')?.emitGameEvents([{ type: 'GAME_RELOAD', t: Date.now() }]);
  res.json({ game: result });
}));

hostRouter.get('/teams', h(async (req: AuthedRequest, res: Response) => {
  res.json(await listTeams(DB, req.game));
}));

hostRouter.post('/teams/:id/disqualify', actionLimiter, h(async (req: AuthedRequest, res: Response) => {
  const { reason } = req.body as { reason?: string };
  const team = await disqualifyTeam(DB, req.game, param(req, 'id'), reason);
  req.app.get('io')?.emitGameEvents([{ type: 'TEAM_DISQUALIFIED', t: Date.now() }]);
  res.json(team);
}));

hostRouter.post('/teams/:id/reinstate', actionLimiter, h(async (req: AuthedRequest, res: Response) => {
  const team = await reinstateTeam(DB, req.game, param(req, 'id'));
  req.app.get('io')?.emitGameEvents([{ type: 'TEAM_JOINED', t: Date.now() }]);
  res.json(team);
}));

hostRouter.get('/questions', h(async (req: AuthedRequest, res: Response) => {
  res.json(await listQuestions(DB, req.game));
}));

hostRouter.post('/questions', actionLimiter, h(async (req: AuthedRequest, res: Response) => {
  const q = await createQuestion(DB, req.game, req.body);
  req.app.get('io')?.emitGameEvents([{ type: 'QUESTION_ADDED', t: Date.now(), questionCode: q.code }]);
  res.status(201).json(q);
}));

hostRouter.patch('/questions/:id', actionLimiter, h(async (req: AuthedRequest, res: Response) => {
  const q = await updateQuestion(DB, req.game, param(req, 'id'), req.body);
  req.app.get('io')?.emitGameEvents([{ type: 'QUESTION_ADDED', t: Date.now(), questionCode: q.code }]);
  res.json(q);
}));

hostRouter.delete('/questions/:id', actionLimiter, h(async (req: AuthedRequest, res: Response) => {
  await deleteQuestion(DB, req.game, param(req, 'id'));
  res.status(204).send();
}));

hostRouter.patch('/questions/:id/enabled', actionLimiter, h(async (req: AuthedRequest, res: Response) => {
  const { enabled } = req.body as { enabled: boolean };
  const q = await toggleEnabled(DB, req.game, param(req, 'id'), enabled);
  req.app.get('io')?.emitGameEvents([{ type: enabled ? 'QUESTION_ENABLED' : 'QUESTION_DISABLED', t: Date.now(), questionCode: q.code }]);
  res.json(q);
}));

hostRouter.post('/questions/import', actionLimiter, h(async (req: AuthedRequest, res: Response) => {
  const { questions } = req.body as { questions: object[] };
  const result = await importQuestions(DB, req.game, questions);
  req.app.get('io')?.emitGameEvents([{ type: 'QUESTION_ADDED', t: Date.now() }]);
  res.json(result);
}));

hostRouter.get('/questions/export', h(async (req: AuthedRequest, res: Response) => {
  const qs = await exportQuestions(DB, req.game);
  res.setHeader('Content-Disposition', 'attachment; filename="questions.json"');
  res.json(qs);
}));

hostRouter.post('/coins/adjust', actionLimiter, h(async (req: AuthedRequest, res: Response) => {
  const { teamId, amount, reason } = req.body as { teamId: string; amount: number; reason: string };
  const result = await adjustCoins(DB, req.game, teamId, amount, reason);
  req.app.get('io')?.emitGameEvents([{ type: 'SCORE_UPDATED', t: Date.now() }]);
  res.json(result);
}));

hostRouter.post('/purchases/refund', actionLimiter, h(async (req: AuthedRequest, res: Response) => {
  const { teamId, questionId, reason } = req.body as { teamId: string; questionId: string; reason: string };
  await refundPurchase(DB, req.game, teamId, questionId, reason);
  req.app.get('io')?.emitGameEvents([{ type: 'SCORE_UPDATED', t: Date.now() }]);
  res.json({ ok: true });
}));

hostRouter.post('/trades/:id/cancel', actionLimiter, h(async (req: AuthedRequest, res: Response) => {
  const { reason } = req.body as { reason: string };
  await cancelTradeAdmin(DB, req.game, param(req, 'id'), reason);
  req.app.get('io')?.emitGameEvents([{ type: 'TRADE_CANCELLED', t: Date.now() }]);
  res.json({ ok: true });
}));

hostRouter.post('/announcements', actionLimiter, h(async (req: AuthedRequest, res: Response) => {
  const { message } = req.body as { message: string };
  const a = await createAnnouncement(DB, req.game, message);
  req.app.get('io')?.emitGameEvents([{ type: 'ANNOUNCEMENT_CREATED', t: Date.now(), message: a.message }]);
  res.json(a);
}));

hostRouter.patch('/config', actionLimiter, h(async (req: AuthedRequest, res: Response) => {
  await updateConfig(DB, req.game, req.body);
  res.json({ ok: true });
}));

hostRouter.post('/force-close', actionLimiter, h(async (req: AuthedRequest, res: Response) => {
  await forceCloseMarket(DB, req.game);
  req.app.get('io')?.emitGameEvents([{ type: 'MARKET_CLOSED', t: Date.now() }]);
  res.json({ ok: true });
}));

hostRouter.get('/leaderboard', h(async (req: AuthedRequest, res: Response) => {
  res.json(await getLeaderboard(DB, req.game));
}));

hostRouter.get('/audit', h(async (req: AuthedRequest, res: Response) => {
  res.json(await getAuditLog(DB, req.game));
}));

hostRouter.get('/transactions', h(async (req: AuthedRequest, res: Response) => {
  const { teamId } = req.query as { teamId?: string };
  res.json(await getTransactions(DB, req.game, teamId));
}));

hostRouter.get('/activity', h(async (req: AuthedRequest, res: Response) => {
  const { sinceSeq } = req.query as { sinceSeq?: string };
  res.json(await getActivity(DB, req.game, sinceSeq ? Number(sinceSeq) : undefined));
}));
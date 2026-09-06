/** Public display endpoints (no auth). */
import { Router, Response, Request } from 'express';
import { prisma as DB } from '../lib/prisma';
import { findGameByCode } from '../domain/games';
import { notFound } from '../lib/errors';
import { toLeaderboard, currentSeq, toActivity } from '../domain/serializers';
import { toGameMeta } from '../domain/serializers';

export const displayRouter = Router();

/** Express 5 params can be `string | string[] | undefined`; codes are always a single segment. */
const param = (req: Request, name: string): string => {
  const v = (req.params as Record<string, string | string[] | undefined>)[name];
  return Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
};

displayRouter.get('/:code', async (req: Request, res: Response) => {
  const game = await findGameByCode(DB, param(req, 'code').toUpperCase());
  if (!game) throw notFound('Game not found.');
  const recent = await DB.gameEvent.findMany({
    where: { gameId: game.id },
    orderBy: { id: 'desc' },
    take: 20,
    include: { team: { select: { name: true } } },
  });
  const [leaderboard, activity, seq] = await Promise.all([
    toLeaderboard(await DB.team.findMany({ where: { gameId: game.id } })),
    recent.map(toActivity),
    currentSeq(DB, game.id),
  ]);
  const meta = toGameMeta(game, await DB.announcement.findMany({ where: { gameId: game.id }, orderBy: { createdAt: 'desc' }, take: 10 }), seq);
  res.json({ meta, leaderboard, recentActivity: [...activity].reverse() });
});

displayRouter.get('/:code/events', async (req: Request, res: Response) => {
  const game = await findGameByCode(DB, param(req, 'code').toUpperCase());
  if (!game) throw notFound('Game not found.');
  const { sinceSeq } = req.query as { sinceSeq?: string };
  const rows = await DB.gameEvent.findMany({
    where: { gameId: game.id, ...(sinceSeq ? { id: { gt: Number(sinceSeq) } } : {}) },
    orderBy: { id: 'asc' },
    take: 200,
    include: { team: { select: { name: true } } },
  });
  const events = rows.map(toActivity);
  const last = events[events.length - 1];
  res.json({ events, seq: last ? Number(last.seq) : 0 });
});
/** Public endpoints: create game, join game (no auth). */
import { Router, Request, Response } from 'express';
import { prisma as DB } from '../lib/prisma';
import { joinLimiter } from '../middleware/ratelimit';
import { createGame, findGameByCode } from '../domain/games';
import { joinGame, joinExisting } from '../domain/teams';
import { notFound } from '../lib/errors';
import {
  createGameSchema,
  joinTeamSchema,
  joinExistingSchema,
} from '@wcc/shared';
import { validate } from '../middleware/validate';

export const publicRouter = Router();

/** Express 5 params can be `string | string[] | undefined`; game codes are a single segment. */
const param = (req: Request, name: string): string => {
  const v = (req.params as Record<string, string | string[] | undefined>)[name];
  return Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
};

publicRouter.post('/games', validate(createGameSchema), async (req: Request, res: Response) => {
  const { title, config } = req.body as { title: string; config?: object };
  const { game, hostToken } = await createGame(DB, { title: title.trim(), config });
  return res.json({ gameCode: game.code, hostToken });
});

publicRouter.get('/games/:code', async (req: Request, res: Response) => {
  const game = await findGameByCode(DB, param(req, 'code').toUpperCase());
  if (!game) throw notFound('Game not found.');
  return res.json({ code: game.code, title: game.title, state: game.state });
});

publicRouter.post('/games/:code/teams/join', joinLimiter, validate(joinTeamSchema), async (req: Request, res: Response) => {
  const game = await findGameByCode(DB, param(req, 'code').toUpperCase());
  if (!game) throw notFound('Game not found.');
  const { teamName, player1, player2 } = req.body as { teamName: string; player1: string; player2?: string };
  const { teamId, teamName: name, teamAccessToken } = await joinGame(DB, game, { teamName, player1, player2 });
  // Broadcast the join so live observers (host dashboard, projector, other
  // teams) re-sync authoritative state immediately. A team registering IS a
  // game state change and must reach the host room over the existing protocol.
  req.app.get('io')?.emitGameEvents(game.code, [{ type: 'TEAM_JOINED', t: Date.now() }]);
  return res.json({ teamId, teamName: name, teamAccessToken });
});

publicRouter.post('/games/:code/teams/join-existing', joinLimiter, validate(joinExistingSchema), async (req: Request, res: Response) => {
  const game = await findGameByCode(DB, param(req, 'code').toUpperCase());
  if (!game) throw notFound('Game not found.');
  const { teamAccessToken } = req.body as { teamAccessToken: string };
  const { teamId, teamName } = await joinExisting(DB, game, teamAccessToken);
  return res.json({ teamId, teamName });
});
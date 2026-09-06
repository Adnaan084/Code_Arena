/** Public endpoints: create game, join game (no auth). */
import { Router, Request, Response } from 'express';
import { prisma as DB } from '../lib/prisma';
import { joinLimiter } from '../middleware/ratelimit';
import { createGame, findGameByCode } from '../domain/games';
import { joinGame, joinExisting } from '../domain/teams';

export const publicRouter = Router();

/** Express 5 params can be `string | string[] | undefined`; game codes are a single segment. */
const param = (req: Request, name: string): string => {
  const v = (req.params as Record<string, string | string[] | undefined>)[name];
  return Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
};

publicRouter.post('/games', async (req: Request, res: Response) => {
  const { title, config } = req.body as { title: string; config?: object };
  if (!title || title.trim().length < 3) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Title must be at least 3 characters' } });
  }
  const { game, hostToken } = await createGame(DB, { title: title.trim(), config });
  return res.json({ gameCode: game.code, hostToken });
});

publicRouter.get('/games/:code', async (req: Request, res: Response) => {
  const game = await findGameByCode(DB, param(req, 'code').toUpperCase());
  if (!game) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Game not found' } });
  return res.json({ code: game.code, title: game.title, state: game.state });
});

publicRouter.post('/games/:code/teams/join', joinLimiter, async (req: Request, res: Response) => {
  const game = await findGameByCode(DB, param(req, 'code').toUpperCase());
  if (!game) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Game not found' } });
  const { teamName, player1, player2 } = req.body as { teamName: string; player1: string; player2?: string };
  if (!teamName?.trim() || !player1?.trim()) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Team name and player 1 are required' } });
  }
  const { teamId, teamName: name, teamAccessToken } = await joinGame(DB, game, { teamName: teamName.trim(), player1: player1.trim(), player2: player2?.trim() });
  return res.json({ teamId, teamName: name, teamAccessToken });
});

publicRouter.post('/games/:code/teams/join-existing', joinLimiter, async (req: Request, res: Response) => {
  const game = await findGameByCode(DB, param(req, 'code').toUpperCase());
  if (!game) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Game not found' } });
  const { teamAccessToken } = req.body as { teamAccessToken: string };
  if (!teamAccessToken) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'teamAccessToken is required' } });
  }
  const { teamId, teamName } = await joinExisting(DB, game, teamAccessToken);
  return res.json({ teamId, teamName });
});
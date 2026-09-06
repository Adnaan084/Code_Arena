/** Express middleware: resolves tokens to (game, role, team?). */
import { Request, Response, NextFunction } from 'express';
import type { Game, Team } from '@prisma/client';
import { extractBearer, sha256 } from './tokens';
import { DB } from '../lib/prisma';

export type AuthedRequest = Request & { game: Game; team?: Team; role: 'HOST' | 'TEAM' };

export async function requireAuth(req: Request, res: Response, next: NextFunction, db: DB) {
  const token = extractBearer(req);
  if (!token) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Missing Bearer token' } });
  const hash = sha256(token);

  const gameHost = await db.game.findFirst({ where: { hostTokenHash: hash } });
  if (gameHost) {
    (req as AuthedRequest).game = gameHost;
    (req as AuthedRequest).role = 'HOST';
    return next();
  }

  const team = await db.team.findFirst({
    where: { accessTokenHash: hash },
    include: { game: true },
  });
  if (team) {
    (req as AuthedRequest).game = team.game;
    (req as AuthedRequest).team = team;
    (req as AuthedRequest).role = 'TEAM';
    return next();
  }

  return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } });
}

/** Convenience: only HOST. Takes a plain Request; the role was stamped by requireAuth. */
export function requireHost(req: Request, res: Response, next: NextFunction) {
  if ((req as AuthedRequest).role !== 'HOST') return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Host access required' } });
  next();
}

/** Convenience: only TEAM. Takes a plain Request; the role was stamped by requireAuth. */
export function requireTeam(req: Request, res: Response, next: NextFunction) {
  const authed = req as AuthedRequest;
  if (authed.role !== 'TEAM') return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Team access required' } });
  if (!authed.team) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Team not found' } });
  next();
}
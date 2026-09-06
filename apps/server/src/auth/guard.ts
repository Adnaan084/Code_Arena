/** Express middleware: resolves tokens to (game, role, team?). */
import { Request, Response, NextFunction } from 'express';
import type { Game, Team } from '@prisma/client';
import { extractBearer, sha256 } from './tokens';
import { DB } from '../lib/prisma';
import { forbidden, unauthorized } from '../lib/errors';

export type AuthedRequest = Request & { game: Game; team?: Team; role: 'HOST' | 'TEAM' };

export async function requireAuth(req: Request, res: Response, next: NextFunction, db: DB) {
  const token = extractBearer(req);
  if (!token) throw unauthorized('Missing Bearer token');
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

  throw unauthorized('Invalid or expired token');
}

/** Convenience: only HOST. Takes a plain Request; the role was stamped by requireAuth. */
export function requireHost(req: Request, res: Response, next: NextFunction) {
  if ((req as AuthedRequest).role !== 'HOST') throw forbidden('Host access required');
  next();
}

/** Convenience: only TEAM. Takes a plain Request; the role was stamped by requireAuth. */
export function requireTeam(req: Request, res: Response, next: NextFunction) {
  const authed = req as AuthedRequest;
  if (authed.role !== 'TEAM') throw forbidden('Team access required');
  if (!authed.team) throw forbidden('Team not found');
  next();
}
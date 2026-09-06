/**
 * Team identity & joining. Teams are a single logical entity with two seats;
 * both players share one team access token, so either device can drive the
 * team and the other sees the result immediately.
 */
import type { Game, Team } from '@prisma/client';
import { type GameConfig, phaseRules } from '@wcc/shared';
import type { DB } from '../lib/prisma';
import { AppError, conflict } from '../lib/errors';
import { randomToken, sha256 } from '../lib/security';
import { gameRules, changeCoins } from './wallet';
import { createEvent } from './feed';

export interface JoinInput {
  teamName: string;
  player1: string;
  player2?: string;
}

export async function joinGame(
  db: DB,
  game: Game,
  input: JoinInput,
): Promise<{ teamId: string; teamName: string; teamAccessToken: string }> {
  const config = game.config as GameConfig;
  const now = new Date();
  const rules = phaseRules(
    { state: game.state, pausedAt: game.pausedAt, startTime: game.startTime, endTime: game.endTime, phaseStartedAt: game.startTime },
    gameRules(config),
    now,
  );
  if (!rules.canJoin) throw new AppError(409, 'JOIN_CLOSED', 'This game is not accepting teams right now.');

  const count = await db.team.count({ where: { gameId: game.id } });
  if (count >= config.maxTeams) throw conflict('The game is full.');

  const teamAccessToken = randomToken(32);
  try {
    const team = await db.$transaction(async (tx) => {
      const created = await tx.team.create({
        data: {
          gameId: game.id,
          name: input.teamName,
          accessTokenHash: sha256(teamAccessToken),
          coins: 0,
          joinOrder: count + 1,
          members: {
            create: [
              { seat: 1, playerName: input.player1 },
              { seat: 2, playerName: input.player2 ?? input.player1 },
            ],
          },
        },
      });
      await changeCoins(tx, { gameId: game.id, teamId: created.id, delta: config.startingCoins, type: 'INITIAL', reason: 'Initial balance' });
      await createEvent(tx, game, 'TEAM_JOINED', { teamId: created.id, teamName: created.name });
      return created;
    });
    return { teamId: team.id, teamName: team.name, teamAccessToken };
  } catch (e) {
    if ((e as { code?: string }).code === 'P2002') {
      throw conflict('A team with this name has already joined this game.');
    }
    throw e;
  }
}

/** Second player seats-in by presenting the team's access token. */
export async function joinExisting(
  db: DB,
  game: Game,
  teamAccessToken: string,
): Promise<{ teamId: string; teamName: string }> {
  const team = await db.team.findFirst({
    where: { gameId: game.id, accessTokenHash: sha256(teamAccessToken) },
  });
  if (!team) throw new AppError(404, 'TEAM_NOT_FOUND', 'No team matches that access code in this game.');
  return { teamId: team.id, teamName: team.name };
}

/** Resolve a team identity from its raw shared access token (null when invalid). */
export async function getTeamIdentity(db: DB, game: Game, teamAccessToken: string): Promise<Team | null> {
  return db.team.findFirst({
    where: { gameId: game.id, accessTokenHash: sha256(teamAccessToken) },
  });
}

export async function disqualifyTeam(db: DB, game: Game, teamId: string, reason?: string): Promise<Team> {
  const team = await db.team.findUnique({ where: { id: teamId } });
  if (!team || team.gameId !== game.id) throw new AppError(404, 'TEAM_NOT_FOUND', 'Team not found in this game.');
  const updated = await db.team.update({
    where: { id: teamId },
    data: { status: 'DISQUALIFIED', online: false },
  });
  if (team.status !== 'DISQUALIFIED') {
    await createEvent(db, game, 'TEAM_DISQUALIFIED', { teamId: team.id, teamName: team.name });
  }
  return updated;
}

export async function reinstateTeam(db: DB, game: Game, teamId: string): Promise<Team> {
  const team = await db.team.findUnique({ where: { id: teamId } });
  if (!team || team.gameId !== game.id) throw new AppError(404, 'TEAM_NOT_FOUND', 'Team not found in this game.');
  return db.team.update({ where: { id: teamId }, data: { status: 'ACTIVE' } });
}
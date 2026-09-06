/**
 * Game lifecycle — create / start / pause / resume / close / finalize / reset.
 * The server owns all timestamps; phase derivation is purely a function of
 * stored timestamps, so a restart cannot lose or distort the clock.
 */
import { randomBytes } from 'node:crypto';
import { Prisma, type Game, type GameEventType, type GameState } from '@prisma/client';
import { type GameConfig, defaultConfigFromEnv, gameConfigSchema } from '@wcc/shared';
import type { DB } from '../lib/prisma';
import { AppError, conflict } from '../lib/errors';
import { randomToken, sha256 } from '../lib/security';
import { refreshScore } from './wallet';
import { createEvent } from './feed';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateGameCode(): string {
  let code = '';
  for (let i = 0; i < 6; i += 1) code += CODE_CHARS.charAt(randomBytes(1)[0]! % CODE_CHARS.length);
  return code;
}

export interface CreateGameInput {
  title: string;
  /** Partial GameConfig; validated and merged over env-backed defaults. */
  config?: Partial<GameConfig>;
}

export async function createGame(
  db: DB,
  input: CreateGameInput,
  opts: { hostTokenBytes?: number } = {},
): Promise<{ game: Game; hostToken: string }> {
  const base = defaultConfigFromEnv();
  const config = gameConfigSchema.parse({ ...base, ...(input.config ?? {}) });

  const hostToken = randomToken(opts.hostTokenBytes ?? 32);
  let code: string;
  let game: Game | null = null;
  for (let attempt = 0; attempt < 5 && !game; attempt += 1) {
    code = generateGameCode();
    try {
      game = await db.game.create({
        data: {
          code,
          title: input.title,
          state: 'LOBBY',
          config: config as object,
          hostTokenHash: sha256(hostToken),
        },
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002' && attempt < 4) continue;
      throw e;
    }
  }
  if (!game) throw conflict('Could not allocate a unique game code. Try again.');
  return { game, hostToken };
}

export async function findGameByCode(db: DB, code: string): Promise<Game | null> {
  return db.game.findUnique({ where: { code } });
}

const inPlayableError = (m: string) => new AppError(409, 'GAME_STATE', m);

/** Host: BEGIN. Requires LOBBY. Sets the authoritative clock. */
export async function startGame(db: DB, gameId: string): Promise<{ result: Game; events: Awaited<ReturnType<typeof createEvent>>[] }> {
  return db.$transaction(async (tx) => {
    const game = await tx.game.findUnique({ where: { id: gameId } });
    if (!game) throw new AppError(404, 'GAME_NOT_FOUND', 'Game not found.');
    if (game.state !== 'LOBBY') throw inPlayableError('The game can only be started from the lobby.');
    if (game.pausedAt) throw inPlayableError('Cannot start while paused.');
    const config = game.config as GameConfig;
    const teams = await tx.team.count({ where: { gameId } });
    if (teams < 1) throw inPlayableError('Add at least one team before starting.');

    const now = new Date();
    const end = new Date(now.getTime() + config.gameDurationMinutes * 60_000);
    const updated = await tx.game.update({
      where: { id: gameId },
      data: { state: 'MARKET_OPEN', startTime: now, endTime: end, pausedAt: null, pausedTotalMs: 0 },
    });
    const e1 = await createEvent(tx, game, 'GAME_STARTED');
    const e2 = await createEvent(tx, game, 'MARKET_OPENED');
    return { result: updated, events: [e1, e2] };
  });
}

/** Host: pause (freezes the clock). */
export async function pauseGame(db: DB, gameId: string): Promise<{ result: Game; events: Awaited<ReturnType<typeof createEvent>>[] }> {
  return db.$transaction(async (tx) => {
    const game = await tx.game.findUnique({ where: { id: gameId } });
    if (!game) throw new AppError(404, 'GAME_NOT_FOUND', 'Game not found.');
    if (game.pausedAt) throw inPlayableError('The game is already paused.');
    if (game.state !== 'MARKET_OPEN' && game.state !== 'FINAL_MINUTE') throw inPlayableError('Only an in-progress game can be paused.');
    const updated = await tx.game.update({ where: { id: gameId }, data: { pausedAt: new Date() } });
    const e = await createEvent(tx, game, 'GAME_PAUSED');
    return { result: updated, events: [e] };
  });
}

/** Host: resume — shifts start/end forward by the pause so the clock continues correctly. */
export async function resumeGame(db: DB, gameId: string): Promise<{ result: Game; events: Awaited<ReturnType<typeof createEvent>>[] }> {
  return db.$transaction(async (tx) => {
    const game = await tx.game.findUnique({ where: { id: gameId } });
    if (!game) throw new AppError(404, 'GAME_NOT_FOUND', 'Game not found.');
    if (!game.pausedAt) throw inPlayableError('The game is not paused.');
    const pauseMs = Date.now() - game.pausedAt.getTime();
    const startTime = game.startTime ? new Date(game.startTime.getTime() + pauseMs) : null;
    const endTime = game.endTime ? new Date(game.endTime.getTime() + pauseMs) : null;
    const updated = await tx.game.update({
      where: { id: gameId },
      data: { pausedAt: null, startTime, endTime, pausedTotalMs: game.pausedTotalMs + pauseMs },
    });
    const e = await createEvent(tx, game, 'GAME_RESUMED');
    return { result: updated, events: [e] };
  });
}

/** Host: force-close the market (also used by the auto timer at deadline). */
export async function closeMarket(db: DB, gameId: string): Promise<{ result: Game; events: Awaited<ReturnType<typeof createEvent>>[] }> {
  return db.$transaction(async (tx) => {
    const game = await tx.game.findUnique({ where: { id: gameId } });
    if (!game) throw new AppError(404, 'GAME_NOT_FOUND', 'Game not found.');
    if (game.state === 'LOBBY') throw inPlayableError('The game has not started.');
    if (game.state === 'COMPLETED') throw inPlayableError('The game is already complete.');
    if (game.state === 'MARKET_CLOSED') throw inPlayableError('The market is already closed.');
    if (game.pausedAt) throw inPlayableError('Pause the game before force-closing the market.');
    const now = new Date();
    const updated = await tx.game.update({
      where: { id: gameId },
      data: { state: 'MARKET_CLOSED', endTime: now },
    });
    const e = await createEvent(tx, game, 'MARKET_CLOSED');
    return { result: updated, events: [e] };
  });
}

/**
 * Final scoring → COMPLETED. Recomputes every team's score from the stored
 * inputs (idempotent), locks the game state and fires GAME_COMPLETED.
 */
export async function finalizeGame(db: DB, gameId: string): Promise<{ result: Game; events: Awaited<ReturnType<typeof createEvent>>[] }> {
  return db.$transaction(async (tx) => {
    const game = await tx.game.findUnique({ where: { id: gameId } });
    if (!game) throw new AppError(404, 'GAME_NOT_FOUND', 'Game not found.');
    if (game.state === 'COMPLETED') return { result: game, events: [] };
    const config = game.config as GameConfig;
    const teams = await tx.team.findMany({ where: { gameId } });
    for (const team of teams) {
      await refreshScore(tx, config, team.id);
    }
    const updated = await tx.game.update({ where: { id: gameId }, data: { state: 'COMPLETED', pausedAt: null } });
    const e = await createEvent(tx, game, 'GAME_COMPLETED');
    return { result: updated, events: [e] };
  });
}

/** Host: RESTART ROUND / EMERGENCY RESET — back to a clean lobby, all state reset. */
export async function resetRound(db: DB, gameId: string): Promise<{ result: Game; events: Awaited<ReturnType<typeof createEvent>>[] }> {
  return db.$transaction(async (tx) => {
    const game = await tx.game.findUnique({ where: { id: gameId } });
    if (!game) throw new AppError(404, 'GAME_NOT_FOUND', 'Game not found.');
    const config = game.config as GameConfig;
    await tx.submission.deleteMany({ where: { gameId } });
    await tx.purchase.deleteMany({ where: { gameId } });
    await tx.questionOwnership.deleteMany({ where: { gameId } });
    await tx.trade.deleteMany({ where: { gameId } });
    await tx.transaction.deleteMany({ where: { gameId } });
    await tx.auditLog.deleteMany({ where: { gameId } });
    await tx.gameEvent.deleteMany({ where: { gameId } });

    const teams = await tx.team.findMany({ where: { gameId } });
    for (const team of teams) {
      await tx.team.update({
        where: { id: team.id },
        data: {
          coins: config.startingCoins,
          score: 0,
          rewardsEarned: 0,
          solvedCount: 0,
          purchasedCount: 0,
          failedCount: 0,
          tradeCount: 0,
          status: 'ACTIVE',
        },
      });
      await tx.transaction.create({
        data: { gameId, teamId: team.id, type: 'INITIAL', amount: config.startingCoins, balanceAfter: config.startingCoins, reason: 'Round reset' },
      });
    }
    const updated = await tx.game.update({
      where: { id: gameId },
      data: { state: 'LOBBY', startTime: null, endTime: null, pausedAt: null, pausedTotalMs: 0 },
    });
    return { result: updated, events: [] };
  });
}

const FINAL_MINUTE_MS = 60_000; // the FINAL_MINUTE window (last 60 s of play)

/**
 * Idempotent, concurrency-safe single phase transition.
 *
 * `updateMany` with a state predicate is an atomic conditional claim: exactly
 * one writer flips the row, and every later/repeated/late call sees count 0
 * and does nothing. This is what makes repeated `advancePhaseIfNeeded` pulses
 * safe — no duplicate transitions and no duplicate events. The state change
 * and its GameEvent commit together in one transaction.
 */
async function claimTransition(
  db: DB,
  game: { id: string },
  fromStates: GameState[],
  toState: GameState,
  eventType: GameEventType,
  extraData: Prisma.GameUpdateManyMutationInput = {},
): Promise<Awaited<ReturnType<typeof createEvent>> | null> {
  return db.$transaction(async (tx) => {
    const claimed = await tx.game.updateMany({
      where: { id: game.id, state: { in: fromStates } },
      data: { ...extraData, state: toState },
    });
    if (claimed.count !== 1) return null;
    return createEvent(tx, game, eventType, {});
  });
}

/** Recompute every team's persisted score from its stored inputs (idempotent). */
async function recomputeAllScores(db: DB, gameId: string, config: GameConfig): Promise<void> {
  const teams = await db.team.findMany({ where: { gameId }, select: { id: true } });
  for (const team of teams) {
    await refreshScore(db, config, team.id);
  }
}

/**
 * Auto-advance: called by the single authoritative timer pulse. Returns the
 * events to broadcast when phases changed. Drives the persisted lifecycle
 * forward as the wall clock crosses each boundary:
 *
 *   MARKET_OPEN → FINAL_MINUTE (≤60 s remain)
 *   MARKET_OPEN|FINAL_MINUTE → MARKET_CLOSED (deadline passes)
 *   MARKET_CLOSED → FINAL_SCORING (after finalScoringDelaySeconds)
 *   FINAL_SCORING → COMPLETED (after scoringDurationSeconds) + final score recompute
 *
 * It only ever moves forward, is idempotent under repeated calls, refuses to
 * run while paused, and derives everything from stored timestamps so a server
 * restart or reconnect cannot distort the clock. LOBBY is only left by the
 * host (startGame); the timer never starts a game by itself.
 */
export async function advancePhaseIfNeeded(db: DB, gameId: string, now = new Date()): Promise<Awaited<ReturnType<typeof createEvent>>[]> {
  const game = await db.game.findUnique({ where: { id: gameId } });
  if (!game || game.pausedAt) return [];
  const config = game.config as GameConfig;
  const endMs = game.endTime ? game.endTime.getTime() : null;
  if (endMs === null) return []; // no clock yet (LOBBY)

  const nowMs = now.getTime();
  const scoringDelayMs = (config.finalScoringDelaySeconds ?? 10) * 1000;
  const scoringDurationMs = (config.scoringDurationSeconds ?? 5) * 1000;
  const events: Awaited<ReturnType<typeof createEvent>>[] = [];
  const state = game.state;

  // MARKET_OPEN → FINAL_MINUTE, exactly once, when ≤60 s remain.
  if (state === 'MARKET_OPEN' && nowMs >= endMs - FINAL_MINUTE_MS) {
    const ev = await claimTransition(db, game, ['MARKET_OPEN'], 'FINAL_MINUTE', 'FINAL_MINUTE');
    if (ev) events.push(ev);
  }

  // MARKET_OPEN | FINAL_MINUTE → MARKET_CLOSED, exactly once, when the deadline passes.
  if ((state === 'MARKET_OPEN' || state === 'FINAL_MINUTE') && nowMs >= endMs) {
    const ev = await claimTransition(db, game, ['MARKET_OPEN', 'FINAL_MINUTE'], 'MARKET_CLOSED', 'MARKET_CLOSED', {
      endTime: now,
    });
    if (ev) events.push(ev);
  }

  // MARKET_CLOSED → FINAL_SCORING after the configured delay.
  if (state === 'MARKET_CLOSED' && nowMs >= endMs + scoringDelayMs) {
    const ev = await claimTransition(db, game, ['MARKET_CLOSED'], 'FINAL_SCORING', 'FINAL_SCORING');
    if (ev) events.push(ev);
  }

  // FINAL_SCORING → COMPLETED once the scoring window elapses; recompute scores first.
  if (state === 'FINAL_SCORING' && nowMs >= endMs + scoringDelayMs + scoringDurationMs) {
    const ev = await claimTransition(db, game, ['FINAL_SCORING'], 'COMPLETED', 'GAME_COMPLETED');
    if (ev) {
      await recomputeAllScores(db, gameId, config);
      events.push(ev);
    }
  }

  return events;
}
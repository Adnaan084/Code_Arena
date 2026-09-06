/**
 * Server-authoritative time handling. The server is the only clock that
 * matters; clients only ever render values derived from these helpers, fed by
 * server timestamps. All functions are pure → unit-testable.
 */
import type { DisplayState, GameState, PhaseRules } from './types';

export interface GameLike {
  state: GameState;
  pausedAt: Date | null;
  /** Monotonic-paused variant: total accumulated pause offset (ms). */
  pausedTotalMs?: number;
  startTime: Date | null;
  endTime: Date | null;
  phaseStartedAt: Date | null;
}

export interface RuleConfig {
  gameDurationMinutes: number;
  tradeWindowMinutes: number;
  allowSubmitAfterClose: boolean;
}

const clamp = (n: number) => Math.max(0, n);

/** Remaining game time in ms at `now`, or 0 once the end has passed. */
export function remainingMs(game: Pick<GameLike, 'startTime' | 'endTime' | 'pausedAt'>, now = new Date()): number {
  if (!game.startTime || !game.endTime) return 0;
  const end = game.endTime.getTime();
  return clamp(end - now.getTime());
}

/** Elapsed game time in ms (paused time excluded). */
export function elapsedMs(
  game: Pick<GameLike, 'startTime' | 'endTime' | 'pausedAt'>,
  pausedTotalMs: number,
  now = new Date(),
): number {
  if (!game.startTime) return 0;
  return Math.max(0, now.getTime() - game.startTime.getTime() - pausedTotalMs);
}

/**
 * Effective state a client should render.
 * LOBBY→MARKET_OPEN→FINAL_MINUTE→MARKET_CLOSED are derived from the stored
 * timestamps so a client that reconnects always sees the correct phase even
 * if no event ever reached it.
 */
export function effectiveState(
  game: Pick<GameLike, 'state' | 'pausedAt' | 'startTime' | 'endTime'>,
  now = new Date(),
): DisplayState {
  if (game.pausedAt) return 'PAUSED';
  if (game.state === 'LOBBY' || game.state === 'MARKET_CLOSED' || game.state === 'FINAL_SCORING' || game.state === 'COMPLETED') {
    return game.state;
  }
  // MARKET_OPEN or FINAL_MINUTE: refine by the wall clock.
  if (game.state === 'MARKET_OPEN' || game.state === 'FINAL_MINUTE') {
    if (!game.startTime || !game.endTime) return 'LOBBY';
    const end = game.endTime.getTime();
    if (now.getTime() >= end) return 'MARKET_CLOSED';
    if (end - now.getTime() <= 60_000) return 'FINAL_MINUTE';
    return 'MARKET_OPEN';
  }
  return game.state;
}

/**
 * What actions are currently legal. This is the single authority both the
 * HTTP handlers and the socket server consult. Paused ⇒ everything off.
 */
export function phaseRules(game: GameLike, config: RuleConfig, now = new Date()): PhaseRules {
  const state = effectiveState(game, now);
  const paused = state === 'PAUSED';
  const inOpen = state === 'MARKET_OPEN' || state === 'FINAL_MINUTE';

  // Trade window closes at min(market close, start + tradeWindowMinutes).
  const marketClose = game.endTime ? game.endTime.getTime() : Number.POSITIVE_INFINITY;
  const tradeClose =
    game.startTime && config.tradeWindowMinutes < config.gameDurationMinutes
      ? game.startTime.getTime() + config.tradeWindowMinutes * 60_000
      : marketClose;
  const nowMs = now.getTime();

  return {
    canBuy: !paused && inOpen,
    canTrade: !paused && inOpen && nowMs < tradeClose && nowMs < marketClose,
    canSubmit: !paused && (inOpen || (config.allowSubmitAfterClose && nowMs >= marketClose)),
    canJoin: !paused && (state === 'LOBBY' || state === 'MARKET_OPEN' || state === 'FINAL_MINUTE'),
    marketOpen: !paused && inOpen,
  };
}

/** Human-readable timer string MM:SS for display. */
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}
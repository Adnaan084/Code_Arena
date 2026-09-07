import { ApiError } from './api';

/**
 * Maps backend error codes (authoritative, from apps/server) to copy that a
 * player/host actually wants to read. Never surface raw HTTP codes.
 */
const CODE_TO_MESSAGE: Record<string, string> = {
  // Session / auth
  UNAUTHORIZED: 'Your session has expired. Please reconnect.',
  FORBIDDEN: 'You don’t have permission to do that.',
  // Marketplace
  MARKET_CLOSED: 'The market is closed.',
  CONFLICT: 'That question was just purchased by another team.',
  TEAM_DISQUALIFIED: 'Your team has been disqualified.',
  INSUFFICIENT_FUNDS: 'You don’t have enough coins.',
  // Past credits: keep the mapping even if the server words it differently.
  SUBMIT_CLOSED: 'Submissions are closed right now.',
  // Trades
  TRADE_STATE: 'This trade is no longer available.',
  TRADING_CLOSED: 'Trading is closed right now.',
  TRADE_EXPIRED: 'This trade has expired.',
  SELF_TRADE: 'A team cannot trade with itself.',
  BAD_TRADE: 'That trade looks invalid.',
  SAME_QUESTION: 'A trade cannot involve the same question twice.',
  // Game
  GAME_STATE: 'That action is not allowed right now.',
  GAME_NOT_FOUND: 'Game not found.',
  JOIN_CLOSED: 'This game is not accepting teams right now.',
  GAME_FULL: 'The game is full.',
  TEAM_NAME_TAKEN: 'A team with that name already joined.',
  TEAM_NOT_FOUND: 'No team matches that access code in this game.',
  // Client plumbing
  NETWORK_ERROR: 'Cannot reach the server. Check the connection.',
};

export function friendlyError(err: unknown): { code: string; message: string } {
  if (err instanceof ApiError) {
    if (err.code === 'CONFLICT' && (err.message ?? '').toLowerCase().includes('coins')) {
      return { code: err.code, message: CODE_TO_MESSAGE['INSUFFICIENT_FUNDS'] ?? err.message };
    }
    return { code: err.code, message: CODE_TO_MESSAGE[err.code] ?? err.message };
  }
  return { code: 'UNKNOWN', message: err instanceof Error ? err.message : 'Something went wrong.' };
}
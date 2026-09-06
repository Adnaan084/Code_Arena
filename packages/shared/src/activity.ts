/**
 * Human-readable activity feed lines, composed deterministically so every
 * viewer (team app, host dashboard, public display, audit) sees the same text.
 */
import type { GameEventType } from './events';

export interface ActivityCtx {
  teamName?: string | null;
  otherTeamName?: string | null;
  questionCode?: string | null;
  amount?: number | null;
  message?: string | null;
}

export function activityMessage(type: GameEventType, ctx: ActivityCtx): string {
  switch (type) {
    case 'GAME_STARTED':
      return 'The market is open. Good luck!';
    case 'GAME_PAUSED':
      return 'Game paused by the host.';
    case 'GAME_RESUMED':
      return 'Game resumed by the host.';
    case 'MARKET_OPENED':
      return 'Market opened.';
    case 'MARKET_CLOSED':
      return 'Market closed. Trading is over.';
    case 'GAME_COMPLETED':
      return 'Final scores have been calculated.';
    case 'TEAM_JOINED':
      return `Team "${ctx.teamName}" joined the game.`;
    case 'TEAM_DISQUALIFIED':
      return `Team "${ctx.teamName}" was disqualified.`;
    case 'TEAM_CONNECTED':
      return `Team "${ctx.teamName}" came online.`;
    case 'TEAM_DISCONNECTED':
      return `Team "${ctx.teamName}" went offline.`;
    case 'QUESTION_ADDED':
      return `Question ${ctx.questionCode} added to the marketplace.`;
    case 'QUESTION_ENABLED':
      return `Question ${ctx.questionCode} enabled.`;
    case 'QUESTION_DISABLED':
      return `Question ${ctx.questionCode} disabled.`;
    case 'QUESTION_PURCHASED':
      return `${ctx.teamName} purchased ${ctx.questionCode} for ${ctx.amount} coins.`;
    case 'QUESTION_SOLVED':
      return `${ctx.teamName} solved ${ctx.questionCode} (+${ctx.amount} coins).`;
    case 'QUESTION_FAILED':
      return `${ctx.teamName} failed ${ctx.questionCode}.`;
    case 'TRADE_CREATED':
      return `${ctx.teamName} proposed a trade with ${ctx.otherTeamName}.`;
    case 'TRADE_ACCEPTED':
      return `${ctx.teamName} accepted a trade with ${ctx.otherTeamName}.`;
    case 'TRADE_REJECTED':
      return `${ctx.teamName} rejected a trade from ${ctx.otherTeamName}.`;
    case 'TRADE_CANCELLED':
      return `${ctx.teamName} cancelled a trade offer.`;
    case 'TRADE_EXPIRED':
      return `A trade offer from ${ctx.teamName} expired.`;
    case 'ANNOUNCEMENT_CREATED':
      return `📢 ${ctx.message ?? 'Announcement from the host'}`;
    default:
      return type;
  }
}
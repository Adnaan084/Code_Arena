import type { Difficulty, DisplayState, QuestionType } from '@wcc/shared';

/** Stable formatters/classifiers shared across all three frontends. */

export function formatCoins(n: number): string {
  return new Intl.NumberFormat('en-US').format(n);
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export function formatTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function timeAgo(iso: string): string {
  const delta = Date.now() - new Date(iso).getTime();
  const s = Math.max(0, Math.floor(delta / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Human label + tone for a game phase (used everywhere, incl. the projector). */
export const PHASE_META: Record<DisplayState, { label: string; tone: 'muted' | 'info' | 'warn' | 'positive' | 'negative' | 'viol' }> = {
  LOBBY: { label: 'LOBBY', tone: 'info' },
  MARKET_OPEN: { label: 'MARKET OPEN', tone: 'positive' },
  FINAL_MINUTE: { label: 'FINAL MINUTE', tone: 'warn' },
  MARKET_CLOSED: { label: 'MARKET CLOSED', tone: 'muted' },
  FINAL_SCORING: { label: 'FINAL SCORING', tone: 'viol' },
  COMPLETED: { label: 'COMPLETED', tone: 'positive' },
  PAUSED: { label: 'PAUSED', tone: 'warn' },
};

export const DIFFICULTY_TONE: Record<Difficulty, string> = {
  EASY: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  MEDIUM: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  HARD: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  EXTREME: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
};

export const QUESTION_TYPE_LABEL: Record<QuestionType, string> = {
  MULTIPLE_CHOICE: 'Multiple choice',
  OUTPUT_PREDICTION: 'Predict output',
  WILL_IT_COMPILE: 'Will it compile?',
  FIND_ERROR: 'Find the error',
  FIND_UB: 'Find UB',
  SHORT_ANSWER: 'Short answer',
  CODE_CORRECTION: 'Fix the code',
  CODING_CHALLENGE: 'Coding challenge',
};

/** Short stock ticker for wallet transactions ("Bought Q17", "Solved Q17", ...). */
export function transactionLabel(type: string, reason: string): string {
  const short = reason.replace(/\s*\(.*?\)\s*$/g, '').trim();
  return short || type.toLowerCase();
}
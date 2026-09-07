import type { DisplayState } from '@wcc/shared';
import { Clock } from 'lucide-react';
import { formatClock, PHASE_META } from '../../lib/format';

const TONE_CLASS = {
  muted: 'border-ink-600 bg-ink-800 text-fg-muted',
  info: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
  positive: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  warn: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  negative: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
  viol: 'border-violet-500/40 bg-violet-500/10 text-violet-300',
};

/**
 * Live phase chip + server-anchored countdown. Purely presentational: the shell
 * passes the authoritative phase and remaining ms it reads from the clock store.
 */
export function PhaseBanner({
  phase,
  remainingMs,
  compact = false,
  className = '',
}: {
  phase: DisplayState | null;
  remainingMs: number | null;
  compact?: boolean;
  className?: string;
}) {
  const meta = (phase && PHASE_META[phase]) ?? PHASE_META.LOBBY;

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-lg border font-mono font-bold uppercase tracking-widest ${TONE_CLASS[meta.tone]} ${
        compact ? 'px-2.5 py-1 text-[11px]' : 'px-3.5 py-1.5 text-sm'
      } ${className}`}
    >
      <span className={phase === 'FINAL_MINUTE' ? 'animate-pulse' : undefined}>{meta.label}</span>
      {remainingMs !== null && phase !== 'LOBBY' && phase !== 'COMPLETED' && (
        <span className="inline-flex items-center gap-1 tabular-nums normal-case tracking-normal">
          <Clock className="size-3.5" aria-hidden />
          {phase === 'FINAL_MINUTE' ? (
            <span className={`font-bold ${compact ? 'text-sm' : 'text-lg'} tabular-nums ${remainingMs <= 30_000 ? 'animate-pulse' : ''}`}>
              {formatClock(remainingMs)}
            </span>
          ) : (
            formatClock(remainingMs)
          )}
        </span>
      )}
    </span>
  );
}
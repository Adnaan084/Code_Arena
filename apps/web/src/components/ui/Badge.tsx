import type { ReactNode } from 'react';

export type BadgeTone = 'muted' | 'info' | 'positive' | 'warn' | 'negative' | 'viol';

const TONES: Record<BadgeTone, string> = {
  muted: 'bg-ink-700 text-fg-muted border-ink-600',
  info: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  positive: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  warn: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  negative: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  viol: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
};

export function Badge({
  tone = 'muted',
  children,
  className = '',
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap ${TONES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
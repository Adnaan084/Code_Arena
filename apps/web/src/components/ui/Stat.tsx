import type { ReactNode } from 'react';

interface StatProps {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  accent?: 'default' | 'positive' | 'negative' | 'warn' | 'info';
  hint?: ReactNode;
  className?: string;
}

const ACCENTS = {
  default: 'text-fg',
  positive: 'text-positive',
  negative: 'text-negative',
  warn: 'text-warn',
  info: 'text-info',
};

/** Large numeric display "stat tile" — wallet balances, score, counts. */
export function Stat({ label, value, icon, accent = 'default', hint, className = '' }: StatProps) {
  return (
    <div className={`rounded-xl border border-ink-700 bg-ink-900/80 px-4 py-3 ${className}`}>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-fg-faint">
        {icon}
        <span>{label}</span>
      </div>
      <div className={`mt-1 font-mono text-2xl md:text-3xl font-bold tabular-nums leading-none ${ACCENTS[accent]}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-fg-muted">{hint}</div>}
    </div>
  );
}
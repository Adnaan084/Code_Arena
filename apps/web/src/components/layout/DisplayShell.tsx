import type { ReactNode } from 'react';
import { Outlet } from 'react-router-dom';
import { useDisplayStore } from '../../stores/display';
import { useServerPhase, useServerRemainingMs } from '../../stores/clock';
import { useRemainingTime } from '../../hooks/useRemainingTime';
import { useGameSocket } from '../../hooks/useGameSocket';
import { PhaseBanner } from '../ui/PhaseBanner';
import { formatClock } from '../../lib/format';

/**
 * Full-screen projector shell. No navigation, no private data — just the
 * public meta, leaderboard and events at massive scale. The background is a
 * subtle grid for that terminal-room feel.
 */
export function DisplayShell({ children }: { children?: ReactNode }) {
  const { meta } = useDisplayStore();
  const gameCode = meta?.code ?? new URLSearchParams(window.location.search).get('code') ?? '';
  useGameSocket('display', gameCode, '');

  const phase = useServerPhase();
  const remaining = useRemainingTime();
  const displayPhase = phase ?? meta?.state ?? null;

  return (
    <div className="terminal-grid flex min-h-screen w-full flex-col">
      <header className="sticky top-0 z-20 border-b border-ink-700/50 bg-ink-950/80 backdrop-blur-lg">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-6">
          <div className="flex items-center gap-4">
            <span className="font-mono text-xl font-bold tracking-widest text-fg">WILL IT COMPILE?</span>
            <span className="hidden md:inline-flex items-center gap-2 rounded-lg border border-ink-600 bg-ink-900/50 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-fg-muted">
              GAME CODE: <span className="text-fg">{gameCode}</span>
            </span>
          </div>
          <div className="flex items-center gap-6 text-right">
            <PhaseBanner phase={displayPhase} remainingMs={remaining} className="text-lg md:text-xl" />
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-auto px-6 py-8">{children ?? <Outlet />}</main>
    </div>
  );
}
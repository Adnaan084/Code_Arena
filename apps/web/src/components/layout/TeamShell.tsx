import type { ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { Coins, FileQuestion, Scale, Sprout, Trophy } from 'lucide-react';
import { useAuthStore } from '../../stores/auth';
import { useTeamStore } from '../../stores/team';
import { useServerPhase } from '../../stores/clock';
import { useRemainingTime } from '../../hooks/useRemainingTime';
import { useGameSocket } from '../../hooks/useGameSocket';
import { formatCoins } from '../../lib/format';
import { ConnectionBadge } from '../ui/ConnectionBadge';
import { PhaseBanner } from '../ui/PhaseBanner';

const TABS = [
  { to: '/team/market', label: 'Market', icon: Sprout },
  { to: '/team/inventory', label: 'Inventory', icon: FileQuestion },
  { to: '/team/trades', label: 'Trades', icon: Scale },
  { to: '/team/leaderboard', label: 'Board', icon: Trophy },
] as const;

/**
 * Mobile-first team shell: sticky header with the wallet always visible, a
 * compact phase banner, a bottom tab bar on phones, and the tab panel below.
 * Both players render the SAME store — whichever device mutates, this one sees
 * it as soon as the authoritative resync lands.
 */
export function TeamShell({ children }: { children?: ReactNode }) {
  const { gameCode, teamToken } = useAuthStore();
  useGameSocket('team', gameCode, teamToken ?? '');

  const team = useTeamStore((s) => s.team);
  const meta = useTeamStore((s) => s.meta);
  const phase = useServerPhase();
  const remaining = useRemainingTime();
  const presence = useTeamStore((s) => s.presence);

  const displayPhase = phase ?? meta?.state ?? null;

  return (
    <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col">
      <header className="sticky top-0 z-30 border-b border-ink-700/70 bg-ink-950/90 backdrop-blur">
        <div className="flex items-center justify-between gap-3 px-4 py-2.5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-bold tracking-widest text-fg">{meta?.code ?? gameCode}</span>
              <ConnectionBadge />
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-fg-muted">
              <span className="truncate font-semibold text-fg">{team?.name ?? '…'}</span>
              {presence && (
                <span className={presence.connectedCount >= 2 ? 'text-positive' : 'text-warn'}>
                  {presence.connectedCount}/2 players connected
                </span>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <PhaseBanner phase={displayPhase} remainingMs={remaining} compact />
            <div
              className="flex items-center gap-1.5 rounded-lg border border-ink-700 bg-ink-900 px-3 py-1.5"
              title="Team coins (server-authoritative)"
            >
              <Coins className="size-4 text-warn" aria-hidden />
              <span className="font-mono text-base font-bold tabular-nums text-fg">{team ? formatCoins(team.coins) : '—'}</span>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 px-3 pb-20 pt-3 sm:px-4 sm:pb-6">{children ?? <Outlet />}</main>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-ink-700/70 bg-ink-900/95 backdrop-blur sm:static sm:rounded-lg sm:border sm:m-3 sm:mt-0">
        <div className="flex sm:grid sm:grid-cols-4">
          {TABS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-semibold uppercase tracking-wide transition-colors cursor-pointer ${
                  isActive ? 'text-accent' : 'text-fg-muted hover:text-fg'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon className={`size-4.5 ${isActive ? 'text-accent' : ''}`} aria-hidden />
                  <span>{label}</span>
                  {isActive && <span className="h-0.5 w-8 rounded-full bg-accent" />}
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
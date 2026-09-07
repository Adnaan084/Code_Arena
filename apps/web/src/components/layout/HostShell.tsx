import type { ReactNode } from 'react';
import { NavLink, Outlet, Link } from 'react-router-dom';
import { Coins, FileQuestion, Scale, Sprout, Trophy, Users, Settings, Activity, ListX, KeyRound } from 'lucide-react';
import { useAuthStore } from '../../stores/auth';
import { useHostStore } from '../../stores/host';
import { useServerPhase, useServerRemainingMs } from '../../stores/clock';
import { useRemainingTime } from '../../hooks/useRemainingTime';
import { useGameSocket } from '../../hooks/useGameSocket';
import { formatCoins } from '../../lib/format';
import { ConnectionBadge } from '../ui/ConnectionBadge';
import { PhaseBanner } from '../ui/PhaseBanner';
import { Card, CardBody, Button } from '../ui';

const SECTIONS = [
  { to: '/host', label: 'Console', icon: ListX, admin: false },
  { to: '/host/lobby', label: 'Teams', icon: Users, admin: false },
  { to: '/host/questions', label: 'Questions', icon: FileQuestion, admin: false },
  { to: '/host/transactions', label: 'Ledger', icon: Coins, admin: false },
  { to: '/host/audit', label: 'Audit', icon: Activity, admin: false },
] as const;

const ACTIONS = [
  { to: '/host', label: 'Start', icon: Sprout, danger: false },
  { to: '/host', label: 'Pause', icon: Scale, danger: false },
  { to: '/host', label: 'Close Market', icon: FileQuestion, danger: true },
] as const;

/** Desktop-first host shell: left rail nav, top bar with live clock, content panel. */
export function HostShell({ children }: { children?: ReactNode }) {
  const { gameCode, hostToken } = useAuthStore();
  useGameSocket('host', gameCode, hostToken ?? '');

  const meta = useHostStore((s) => s.meta);
  const teams = useHostStore((s) => s.teams);
  const phase = useServerPhase();
  const remaining = useRemainingTime();
  const connected = useHostStore((s) => s.connectedCount);

  const displayPhase = phase ?? meta?.state ?? null;

  // No host session (never created a game, or credentials were cleared): a host
  // token is shown exactly once at creation and cannot be recovered, so the
  // only path here is to create a new game. Authoritative state is never stored
  // anywhere local — it returns only when a live socket delivers state:sync.
  if (!gameCode || !hostToken) {
    return (
      <div className="flex min-h-full w-full items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardBody className="pt-4 text-center">
            <KeyRound className="mx-auto size-10 text-warn" aria-hidden />
            <h1 className="mt-3 text-lg font-bold text-fg">NO HOST SESSION</h1>
            <p className="mt-2 text-sm text-fg-muted">
              The host token is shown only once when a game is created and cannot be recovered.
              Open the host console by creating a new game.
            </p>
            <div className="mt-4">
              <Link to="/create" className="w-full">
                <Button variant="primary" size="lg" full>
                  CREATE HOST GAME
                </Button>
              </Link>
            </div>
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-full w-full">
      <aside className="hidden lg:flex h-full w-64 flex-col border-r border-ink-700/70 bg-ink-900/80">
        <div className="flex h-16 items-center justify-between border-b border-ink-700/70 px-4">
          <span className="font-mono text-xs font-bold tracking-widest text-fg">HOST</span>
          <PhaseBanner phase={displayPhase} remainingMs={remaining} compact />
        </div>
        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
          {SECTIONS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold transition-colors cursor-pointer ${
                  isActive ? 'bg-accent/10 text-accent' : 'text-fg-muted hover:text-fg hover:bg-ink-800'
                }`
              }
            >
              <Icon className="size-4" aria-hidden />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden lg:flex-1">
        <header className="sticky top-0 z-20 border-b border-ink-700/70 bg-ink-950/90 backdrop-blur">
          <div className="flex items-center justify-between gap-4 px-4 py-2.5">
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-bold tracking-widest text-fg">{gameCode ?? '—'}</span>
              <ConnectionBadge />
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5 font-mono text-sm">
                <span className="text-fg-muted">{teams.length}/{meta?.maxTeams ?? '—'} teams</span>
                <span className="text-fg-faint">|</span>
                <span className="text-info">Σ {teams.reduce((a, t) => a + (connected(t.id) ?? (t.online ? 1 : 0)), 0)} players</span>
              </div>
              <PhaseBanner phase={displayPhase} remainingMs={remaining} />
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-auto p-4 lg:p-6">{children ?? <Outlet />}</div>
      </main>
    </div>
  );
}
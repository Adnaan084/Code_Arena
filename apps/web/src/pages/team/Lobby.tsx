import { Users, Coins, Scale, Sprout, Trophy, UserCheck, UserX } from 'lucide-react';
import { Card, CardBody, Badge, EmptyState, Button } from '../../components/ui';
import { useTeamStore } from '../../stores/team';
import { useAuthStore } from '../../stores/auth';
import { formatClock } from '../../lib/format';
import { formatCoins } from '../../lib/format';

/** Lobby before market opens: shows team identity, partner connection, game phase. */
export function TeamLobby() {
  const { gameCode, teamName, playerName } = useAuthStore();
  const team = useTeamStore((s) => s.team);
  const meta = useTeamStore((s) => s.meta);
  const presence = useTeamStore((s) => s.presence);

  const displayPhase = meta?.state ?? 'LOBBY';
  const canBuy = meta?.phase?.canBuy ?? false;

  const players = [
    { seat: 1, name: playerName ?? '—', connected: presence ? presence.connectedCount >= 1 : false },
    { seat: 2, name: '—', connected: presence ? presence.connectedCount >= 2 : false },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardBody className="pt-2">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs font-bold tracking-widest text-fg-muted">
                <span>GAME</span>
                <span className="font-mono text-fg">{gameCode}</span>
              </div>
              <h1 className="mt-1 truncate text-xl font-bold text-fg">{teamName}</h1>
            </div>
            <div className="text-right">
              <div className="font-mono text-3xl font-bold tabular-nums text-fg">{formatCoins(team?.coins ?? 0)}</div>
              <div className="text-xs text-fg-muted">COINS</div>
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {players.map((p) => (
              <div
                key={p.seat}
                className={`rounded-lg border p-4 ${p.connected ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-ink-700 bg-ink-850'}`}
              >
                <div className="flex items-center gap-2">
                  <span className={`size-2 rounded-full ${p.connected ? 'bg-emerald-400' : 'bg-ink-600'}`} aria-hidden />
                  <span className="text-sm font-semibold text-fg">PLAYER {p.seat}</span>
                  {p.connected && <span className="ml-auto text-[10px] font-bold text-emerald-400">CONNECTED</span>}
                </div>
                <div className="mt-1 text-sm text-fg-muted">{p.name}</div>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="pt-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Sprout className="size-5 text-accent" />
              <span className="text-sm font-semibold uppercase tracking-widest text-fg-muted">GAME STATUS</span>
            </div>
            <Badge tone={displayPhase === 'MARKET_OPEN' ? 'positive' : displayPhase === 'FINAL_MINUTE' ? 'warn' : 'muted'}>
              {displayPhase}
            </Badge>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-3 text-center">
            <div className="rounded-lg border border-ink-700 bg-ink-850 p-3">
              <div className="font-mono text-2xl font-bold text-fg">{meta?.maxTeams ?? '—'}</div>
              <div className="text-xs text-fg-muted">MAX TEAMS</div>
            </div>
            <div className="rounded-lg border border-ink-700 bg-ink-850 p-3">
              <div className="font-mono text-2xl font-bold text-fg">{meta?.gameDurationMinutes ?? '—'} min</div>
              <div className="text-xs text-fg-muted">DURATION</div>
            </div>
            <div className="rounded-lg border border-ink-700 bg-ink-850 p-3">
              <div className="font-mono text-2xl font-bold text-fg">{formatCoins(meta?.startingCoins ?? 1000)}</div>
              <div className="text-xs text-fg-muted">STARTING COINS</div>
            </div>
          </div>

          {displayPhase === 'LOBBY' && (
            <div className="mt-4 p-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-300 text-sm">
              Waiting for the host to start the game. The market will open when the host begins.
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
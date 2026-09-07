import { Sprout, Pause, RotateCcw, X, Scale, FileQuestion, Plus, Settings, AlertTriangle } from 'lucide-react';
import { Card, CardBody, Badge, Button, EmptyState, Stat } from '../../components/ui';
import { useHostStore } from '../../stores/host';
import { useAuthStore } from '../../stores/auth';
import { formatCoins } from '../../lib/format';
import { formatClock } from '../../lib/format';

/** Host console: live game state + phase controls. */
export function HostConsole() {
  const { gameCode, hostToken } = useAuthStore();
  const meta = useHostStore((s) => s.meta);
  const teams = useHostStore((s) => s.teams);
  const questions = useHostStore((s) => s.questions);
  const activity = useHostStore((s) => s.activity).slice(0, 5);
  const leaderboard = useHostStore((s) => s.leaderboard);
  const connected = useHostStore((s) => s.connectedCount);

  const phase = meta?.phase;
  const displayPhase = meta?.state ?? 'LOBBY';

  return (
    <div className="space-y-4">
      <Card>
        <CardBody className="pt-2">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-xl font-bold text-fg">{meta?.title ?? 'Will It Compile?'}</h1>
              <div className="mt-1 flex items-center gap-2 text-sm text-fg-muted">
                <span className="font-mono">{gameCode}</span>
                <span>•</span>
                <span>{teams.length}/{meta?.maxTeams ?? '—'} teams</span>
              </div>
            </div>
            <div className="text-right">
              <div className="font-mono text-2xl font-bold tabular-nums text-fg">{teams.length}</div>
              <div className="text-xs text-fg-muted">TEAMS JOINED</div>
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-4">
            <Stat label="Starting Coins" value={formatCoins(meta?.startingCoins ?? 1000)} />
            <Stat label="Duration" value={`${meta?.gameDurationMinutes ?? '—'} min`} />
            <Stat label="Max Teams" value={String(meta?.maxTeams ?? '—')} />
            <Stat label="Players/Team" value={String(meta?.playersPerTeam ?? 2)} />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="pt-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Sprout className="size-5 text-accent" />
              <span className="text-sm font-semibold uppercase tracking-widest text-fg-muted">GAME PHASE</span>
            </div>
            <Badge tone={displayPhase === 'MARKET_OPEN' ? 'positive' : displayPhase === 'FINAL_MINUTE' ? 'warn' : displayPhase === 'PAUSED' ? 'warn' : 'muted'}>
              {displayPhase}
            </Badge>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button variant={phase?.canBuy ? 'primary' : 'secondary'} size="md" disabled={displayPhase !== 'LOBBY'}>
              <Sprout className="size-3.5" /> START GAME
            </Button>
            <Button variant={phase?.marketOpen && displayPhase === 'MARKET_OPEN' ? 'secondary' : 'ghost'} size="md" disabled={displayPhase !== 'MARKET_OPEN' && displayPhase !== 'FINAL_MINUTE'}>
              <Pause className="size-3.5" /> PAUSE
            </Button>
            <Button variant={displayPhase === 'PAUSED' ? 'primary' : 'ghost'} size="md" disabled={displayPhase !== 'PAUSED'}>
              <RotateCcw className="size-3.5" /> RESUME
            </Button>
            <Button variant="danger" size="md" disabled={displayPhase === 'MARKET_CLOSED' || displayPhase === 'FINAL_SCORING' || displayPhase === 'COMPLETED'}>
              <Scale className="size-3.5" /> CLOSE MARKET
            </Button>
            <Button variant="ghost" size="md" disabled={displayPhase !== 'COMPLETED'}>
              <AlertTriangle className="size-3.5" /> RESET ROUND
            </Button>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="pt-2">
          <div className="flex items-center justify-between gap-3 mb-3">
            <h3 className="text-sm font-semibold uppercase tracking-widest text-fg-muted">RECENT ACTIVITY</h3>
            <span className="text-[11px] text-fg-muted">{activity.length} events</span>
          </div>
          {activity.length === 0 ? (
            <EmptyState title="No activity yet" body="Events appear here as teams join, buy, solve, and trade." />
          ) : (
            <div className="space-y-2">
              {activity.map((a, i) => (
                <div key={i} className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-fg">{a.message}</span>
                  <span className="text-fg-muted font-mono">{new Date(a.at).toLocaleTimeString()}</span>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardBody className="pt-2">
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-widest text-fg-muted">TOP 5</h3>
          {leaderboard.length === 0 ? (
            <EmptyState title="No teams yet" body="Leaderboard populates when teams join." />
          ) : (
            <div className="space-y-2">
              {leaderboard.slice(0, 5).map((r) => (
                <div key={r.teamName} className="flex items-center justify-between gap-3 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="w-8 text-center font-mono font-bold text-fg-muted">{r.rank}</span>
                    <span className="font-medium text-fg">{r.teamName}</span>
                  </div>
                  <div className="flex items-center gap-4 text-[11px] text-fg-muted">
                    <span className="font-mono text-warn">{formatCoins(r.coins)}</span>
                    <span className="font-mono">{r.score}</span>
                    <span>{r.solved} solved</span>
                    <span>{r.trades} trades</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
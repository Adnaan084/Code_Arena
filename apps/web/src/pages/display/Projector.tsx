import { Trophy, Coins, FileQuestion, Scale, Clock, Zap, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { Card, CardBody, Badge, EmptyState } from '../../components/ui';
import { useDisplayStore } from '../../stores/display';
import { useServerPhase, useServerRemainingMs } from '../../stores/clock';
import { useRemainingTime } from '../../hooks/useRemainingTime';
import { formatClock, formatCoins, PHASE_META } from '../../lib/format';
import { formatTime, timeAgo } from '../../lib/format';

/** Public projector display — full-screen, large text, no private data. */
export function DisplayProjector() {
  const meta = useDisplayStore((s) => s.meta);
  const leaderboard = useDisplayStore((s) => s.leaderboard);
  const recentActivity = useDisplayStore((s) => s.recentActivity);
  const phase = useServerPhase();
  const remaining = useRemainingTime();

  const displayPhase = phase ?? meta?.state ?? 'LOBBY';
  const phaseMeta = PHASE_META[displayPhase] ?? PHASE_META.LOBBY;

  return (
    <div className="mx-auto grid max-w-7xl gap-6 p-6 lg:grid-cols-[1fr_320px] lg:gap-8">
      {/* Left column: Phase + Leaderboard */}
      <div className="space-y-6">
        {/* Phase banner — massive */}
        <Card className={`border-2 ${phaseMeta.tone === 'positive' ? 'border-emerald-500/50 bg-emerald-500/10' : phaseMeta.tone === 'warn' ? 'border-amber-500/50 bg-amber-500/10' : 'border-ink-700'}`}>
          <CardBody className="py-8 text-center">
            <div className="flex items-center justify-center gap-4 mb-4">
              <span className={`text-2xl md:text-3xl font-mono font-bold uppercase tracking-widest ${phaseMeta.tone === 'positive' ? 'text-emerald-300' : phaseMeta.tone === 'warn' ? 'text-amber-300' : phaseMeta.tone === 'viol' ? 'text-violet-300' : 'text-fg'}`}>
                {phaseMeta.label}
              </span>
              {remaining !== null && displayPhase !== 'LOBBY' && displayPhase !== 'COMPLETED' && (
                <span className="font-mono text-3xl md:text-5xl font-bold tabular-nums text-fg">{formatClock(remaining)}</span>
              )}
            </div>
            {meta && (
              <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-fg-muted">
                <span className="flex items-center gap-1">
                  <Clock className="size-3.5" />
                  {meta.gameDurationMinutes} min game
                </span>
                <span className="flex items-center gap-1">
                  <Trophy className="size-3.5" />
                  {leaderboard.length} teams
                </span>
              </div>
            )}
          </CardBody>
        </Card>

        {/* Leaderboard — large table */}
        <Card>
          <CardBody className="pt-2">
            <h3 className="mb-3 text-lg font-semibold uppercase tracking-widest text-fg-muted">LIVE LEADERBOARD</h3>
            {leaderboard.length === 0 ? (
              <EmptyState title="No teams yet" body="Teams will appear when the game starts." className="py-8" />
            ) : (
              <div className="space-y-1">
                {/* Header */}
                <div className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-3 px-2 text-sm font-semibold uppercase tracking-widest text-fg-muted border-b border-ink-700 pb-2">
                  <span className="w-10 text-center">#</span>
                  <span>TEAM</span>
                  <span className="w-28 text-right">SCORE</span>
                  <span className="w-28 text-right">COINS</span>
                  <span className="w-24 text-right">SOLVED</span>
                </div>
                {leaderboard.slice(0, 12).map((row, i) => (
                  <div
                    key={row.teamName}
                    className={`grid grid-cols-[auto_1fr_auto_auto_auto] gap-3 px-2 py-3 items-center border-b border-ink-700/50 ${
                      i < 3 ? 'bg-emerald-500/5 border-emerald-500/20' : ''
                    }`}
                  >
                    <span className={`w-10 text-center font-mono font-bold text-xl ${i === 0 ? 'text-amber-300' : i === 1 ? 'text-zinc-300' : i === 2 ? 'text-amber-700' : 'text-fg'}`}>
                      {row.rank}
                    </span>
                    <span className="font-medium text-lg text-fg">{row.teamName}</span>
                    <span className="w-28 text-right font-mono text-xl font-bold text-fg">{row.score}</span>
                    <span className="w-28 text-right font-mono text-xl font-bold text-warn">{formatCoins(row.coins)}</span>
                    <span className="w-24 text-right font-mono text-lg">{row.solved}</span>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Right column: Activity feed */}
      <div className="space-y-6">
        <Card>
          <CardBody className="pt-2">
            <h3 className="mb-3 text-lg font-semibold uppercase tracking-widest text-fg-muted">RECENT ACTIVITY</h3>
            {recentActivity.length === 0 ? (
              <EmptyState title="Waiting for activity" body="Game events will appear here." className="py-8" />
            ) : (
              <div className="space-y-3 max-h-[500px] overflow-y-auto">
                {recentActivity.slice(0, 20).map((a, i) => (
                  <div key={i} className="flex flex-col gap-1.5 p-3 rounded-lg border border-ink-700/50 bg-ink-900/50">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-fg">{a.message}</span>
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-fg-muted">
                      <span>{formatTime(a.at)}</span>
                      <span>{timeAgo(a.at)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        {/* Announcements if any */}
        {meta?.announcements && meta.announcements.length > 0 && (
          <Card className="border-violet-500/30 bg-violet-500/5">
            <CardBody className="pt-2">
              <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold uppercase tracking-widest text-violet-300">
                <AlertTriangle className="size-5" />
                ANNOUNCEMENTS
              </h3>
              <div className="space-y-2">
                {meta.announcements.slice(0, 3).map((a, i) => (
                  <div key={i} className="p-3 rounded-lg border border-violet-500/20 bg-violet-500/10">
                    <p className="text-violet-100">{a.message}</p>
                    <div className="mt-1 text-[10px] text-violet-300/70">{formatTime(a.createdAt)}</div>
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  );
}
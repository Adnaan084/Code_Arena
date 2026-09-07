import { Trophy, Coins, FileQuestion, Scale } from 'lucide-react';
import { Card, CardBody, Badge, EmptyState } from '../../components/ui';
import { useTeamStore } from '../../stores/team';
import { formatCoins } from '../../lib/format';

/** Live leaderboard — team sees the same board the host and projector show. */
export function TeamLeaderboard() {
  const leaderboard = useTeamStore((s) => s.leaderboard);
  const team = useTeamStore((s) => s.team);
  const meta = useTeamStore((s) => s.meta);

  const myRank = leaderboard.find((r) => r.teamName === team?.name);

  return (
    <div className="space-y-3">
      {myRank && (
        <Card className="border-emerald-500/30 bg-emerald-500/5">
          <CardBody className="pt-2">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Trophy className="size-5 text-emerald-300" />
                <span className="text-sm font-semibold uppercase tracking-widest text-emerald-300">YOUR RANK</span>
              </div>
              <div className="text-right">
                <div className="font-mono text-2xl font-bold text-emerald-300">#{myRank.rank}</div>
                <div className="text-xs text-emerald-300/80">OF {meta?.maxTeams ?? '—'}</div>
              </div>
            </div>
            <div className="mt-2 grid grid-cols-4 gap-2 text-center text-[11px]">
              <div>
                <div className="font-mono text-lg font-bold text-fg">{myRank.score}</div>
                <div className="text-fg-muted">SCORE</div>
              </div>
              <div>
                <div className="font-mono text-lg font-bold text-warn">{formatCoins(myRank.coins)}</div>
                <div className="text-fg-muted">COINS</div>
              </div>
              <div>
                <div className="font-mono text-lg font-bold text-fg">{myRank.solved}</div>
                <div className="text-fg-muted">SOLVED</div>
              </div>
              <div>
                <div className="font-mono text-lg font-bold text-fg">{myRank.trades}</div>
                <div className="text-fg-muted">TRADES</div>
              </div>
            </div>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardBody className="pt-2 pb-0">
          <div className="grid grid-cols-[auto_auto_1fr_auto_auto_auto_auto] gap-2 px-2 text-[11px] font-semibold uppercase tracking-widest text-fg-muted border-b border-ink-700 pb-2">
            <span className="w-8 text-center">#</span>
            <span className="w-8 text-center">Δ</span>
            <span>TEAM</span>
            <span className="w-24 text-right">SCORE</span>
            <span className="w-24 text-right">COINS</span>
            <span className="w-16 text-right">SOLVED</span>
            <span className="w-16 text-right">TRADES</span>
          </div>
          {leaderboard.length === 0 ? (
            <EmptyState title="No teams yet" body="Teams will appear when they join." className="py-6" />
          ) : (
            <div className="divide-y divide-ink-700/50">
              {leaderboard.map((row, i) => (
                <div
                  key={row.teamName}
                  className={`grid grid-cols-[auto_auto_1fr_auto_auto_auto_auto] gap-2 px-2 py-2 items-center ${
                    row.teamName === team?.name ? 'bg-emerald-500/5' : ''
                  }`}
                >
                  <span className="w-8 text-center font-mono font-bold">{row.rank}</span>
                  <span className="w-8 text-center text-fg-muted">—</span>
                  <span className="truncate font-medium text-fg">{row.teamName}</span>
                  <span className="w-24 text-right font-mono font-bold">{row.score}</span>
                  <span className="w-24 text-right font-mono font-bold text-warn">{formatCoins(row.coins)}</span>
                  <span className="w-16 text-right font-mono">{row.solved}</span>
                  <span className="w-16 text-right font-mono">{row.trades}</span>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
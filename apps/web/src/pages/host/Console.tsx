import { useMemo, useState } from 'react';
import {
  Sprout,
  Users,
  Wifi,
  WifiOff,
  Trophy,
  Coins,
  ListX,
  Pause,
  RotateCcw,
  Scale,
  AlertTriangle,
  Activity,
  Flag,
} from 'lucide-react';
import { Card, CardBody, Badge, Button, EmptyState, Stat, Modal } from '../../components/ui';
import { useHostStore } from '../../stores/host';
import { useAuthStore } from '../../stores/auth';
import { useServerPhase, useServerPhaseRules } from '../../stores/clock';
import { useRemainingTime } from '../../hooks/useRemainingTime';
import { useHostAction } from '../../hooks/useHostAction';
import { formatCoins, formatClock, formatTime, timeAgo } from '../../lib/format';
import type { DisplayState } from '@wcc/shared';

/**
 * Host dashboard — the operational landing for the event operator.
 *
 * Everything here is derived from the server-authoritative snapshot the host
 * socket receives: `state:sync` replaces the store wholesale and `time:sync`
 * (pulsed every second) is the ONLY clock the UI renders. The browser never
 * becomes the source of truth; useRemainingTime() just renders the last
 * server anchor and ticks locally between pulses.
 */

type MarketStatus = 'PRE-GAME' | 'OPEN' | 'PAUSED' | 'CLOSED';

function marketStatus(state: DisplayState): MarketStatus {
  switch (state) {
    case 'LOBBY':
      return 'PRE-GAME';
    case 'MARKET_OPEN':
    case 'FINAL_MINUTE':
      return 'OPEN';
    case 'PAUSED':
      return 'PAUSED';
    default:
      return 'CLOSED';
  }
}

const MARKET_TONE: Record<MarketStatus, 'info' | 'positive' | 'warn' | 'muted'> = {
  'PRE-GAME': 'info',
  OPEN: 'positive',
  PAUSED: 'warn',
  CLOSED: 'muted',
};

const PHASE_TONE: Record<DisplayState, 'muted' | 'info' | 'positive' | 'warn' | 'negative' | 'viol'> = {
  LOBBY: 'info',
  MARKET_OPEN: 'positive',
  FINAL_MINUTE: 'warn',
  MARKET_CLOSED: 'muted',
  FINAL_SCORING: 'viol',
  COMPLETED: 'positive',
  PAUSED: 'warn',
};

/** Destructive/high-impact lifecycle actions require an explicit confirm. */
const CONFIRM_META: Record<
  'close-market' | 'finalize' | 'reset',
  { title: string; body: string; confirmLabel: string }
> = {
  'close-market': {
    title: 'CLOSE MARKET?',
    body: 'Closing the market freezes buying, selling, and trading for every team and begins the final scoring sequence.',
    confirmLabel: 'CLOSE MARKET',
  },
  finalize: {
    title: 'END GAME?',
    body: 'Ending the game computes the final scores and locks the results. This cannot be undone.',
    confirmLabel: 'END GAME',
  },
  reset: {
    title: 'RESET GAME?',
    body: 'Resetting the game will reset the current game state. This action cannot be undone. Purchases, solves, trades, and the ledger will be wiped, and teams return to their starting balance.',
    confirmLabel: 'RESET GAME',
  },
};

export function HostConsole() {
  const { gameCode } = useAuthStore();
  const meta = useHostStore((s) => s.meta);
  const teams = useHostStore((s) => s.teams);
  const leaderboard = useHostStore((s) => s.leaderboard);
  const activity = useHostStore((s) => s.activity);
  const transactions = useHostStore((s) => s.transactions);
  const lastEventSeq = useHostStore((s) => s.lastEventSeq);
  const connectedCount = useHostStore((s) => s.connectedCount);

  const { run, isBusy, isBusyAction } = useHostAction();
  const [confirmAction, setConfirmAction] = useState<'close-market' | 'finalize' | 'reset' | null>(null);

  /** Confirm modals close on success; stay open on failure so the host can retry or cancel. */
  const confirmAndRun = async () => {
    if (!confirmAction) return;
    const ok = await run(confirmAction);
    if (ok) setConfirmAction(null);
  };

  // Authoritative phase + clock come from time:sync (server); meta.state is the
  // fallback until the first pulse lands.
  const serverPhase = useServerPhase() ?? meta?.state ?? 'LOBBY';
  const phaseRules = useServerPhaseRules() ?? meta?.phase ?? null;
  const remaining = useRemainingTime();

  const registered = teams.length;
  const playersPerTeam = meta?.playersPerTeam ?? 2;
  const activeTeams = teams.filter((t) => t.status === 'ACTIVE').length;

  // Presence aggregates: live socket seats win; a team with no presence yet
  // reads its `online` flag (both players share one socket when the fallback
  // applies, so "online" counts as one connected seat).
  const connectedPlayers = teams.reduce(
    (acc, t) => acc + (connectedCount(t.id) ?? (t.online ? 1 : 0)),
    0,
  );
  const seatsFilled = registered * playersPerTeam;
  const offlinePlayers = Math.max(0, seatsFilled - connectedPlayers);

  // Economy totals are built from the server-counted per-team counters, so they
  // are complete even when the activity feed is truncated. Every executed trade
  // increments BOTH parties' tradeCount, so the executed count is half the sum.
  const economy = useMemo(() => {
    let purchases = 0;
    let solves = 0;
    let fails = 0;
    let tradeActions = 0;
    for (const t of teams) {
      purchases += t.purchasedCount;
      solves += t.solvedCount;
      fails += t.failedCount;
      tradeActions += t.tradeCount;
    }
    return { purchases, solves, fails, trades: Math.floor(tradeActions / 2) };
  }, [teams]);

  const mkt = marketStatus(serverPhase);
  const inPlay = serverPhase !== 'LOBBY' && serverPhase !== 'COMPLETED';

  // END GAME (finalize): valid once a game has started, until it is complete.
  // Backend finalizeGame is guardless (and idempotent on COMPLETED); the UI keeps
  // it off in LOBBY and while paused so a host starts/closes cleanly first.
  const canEndGame =
    serverPhase === 'MARKET_OPEN' ||
    serverPhase === 'FINAL_MINUTE' ||
    serverPhase === 'MARKET_CLOSED' ||
    serverPhase === 'FINAL_SCORING';

  return (
    <div className="space-y-4">
      {/* ── Hero: authoritative phase + timer + server clock ─────────────── */}
      <div className="rounded-2xl border border-ink-700 bg-ink-900/80 p-4 lg:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-fg-muted">
              <Sprout className="size-4 text-accent" aria-hidden />
              <span>{meta?.title ?? 'Will It Compile?'}</span>
              <span className="text-fg-faint">·</span>
              <span className="font-mono">{gameCode}</span>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <span
                className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 font-mono text-2xl font-bold uppercase tracking-widest ${
                  serverPhase === 'FINAL_MINUTE' || serverPhase === 'PAUSED' ? 'animate-pulse' : ''
                } ${
                  serverPhase === 'MARKET_OPEN'
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                    : serverPhase === 'FINAL_MINUTE'
                      ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                      : serverPhase === 'FINAL_SCORING'
                        ? 'border-violet-500/40 bg-violet-500/10 text-violet-300'
                        : serverPhase === 'COMPLETED'
                          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                          : serverPhase === 'PAUSED'
                            ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                            : serverPhase === 'MARKET_CLOSED'
                              ? 'border-ink-600 bg-ink-800 text-fg-muted'
                              : 'border-sky-500/40 bg-sky-500/10 text-sky-300'
                }`}
              >
                {serverPhase}
              </span>
              <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-fg-faint">
                <Activity className="size-3" aria-hidden />
                LIVE · SEQ {lastEventSeq}
              </span>
            </div>
          </div>

          <div className="text-right">
            <div className="text-[11px] font-semibold uppercase tracking-widest text-fg-faint">
              {inPlay ? 'TIME REMAINING' : 'COUNTDOWN'}
            </div>
            <div
              title="Phase countdown (server-authoritative)"
              className={`mt-1 font-mono text-4xl font-bold tabular-nums leading-none lg:text-6xl ${
                remaining !== null ? 'text-fg' : 'text-fg-faint'
              } ${serverPhase === 'FINAL_MINUTE' && remaining !== null && remaining <= 30_000 ? 'animate-pulse text-warn' : ''}`}
            >
              {remaining !== null ? formatClock(remaining) : '--:--'}
            </div>
            <div className="mt-1.5 flex items-center justify-end gap-2">
              <Badge tone={MARKET_TONE[mkt]}>MARKET {mkt}</Badge>
              <Badge tone={PHASE_TONE[serverPhase]}>
                {serverPhase === 'PAUSED' ? 'PAUSED' : phaseRules?.marketOpen ? 'TRADING OPEN' : 'TRADING CLOSED'}
              </Badge>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-ink-800 pt-3">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted">
            <span>START <span className="font-mono text-fg">{formatTime(meta?.startTime ?? null)}</span></span>
            <span>END <span className="font-mono text-fg">{formatTime(meta?.endTime ?? null)}</span></span>
            <span>DURATION <span className="font-mono text-fg">{meta?.gameDurationMinutes ?? '—'} min</span></span>
            <span>STARTING <span className="font-mono text-fg">{formatCoins(meta?.startingCoins ?? 0)}</span></span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 text-[10px] font-semibold uppercase tracking-widest text-fg-faint">Lifecycle</span>
            <Button
              variant={serverPhase === 'LOBBY' ? 'primary' : 'secondary'}
              size="sm"
              disabled={serverPhase !== 'LOBBY' || isBusy}
              loading={isBusyAction('start')}
              onClick={() => void run('start')}
            >
              <Sprout className="size-3.5" /> START
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={(serverPhase !== 'MARKET_OPEN' && serverPhase !== 'FINAL_MINUTE') || isBusy}
              loading={isBusyAction('pause')}
              onClick={() => void run('pause')}
            >
              <Pause className="size-3.5" /> PAUSE
            </Button>
            <Button
              variant={serverPhase === 'PAUSED' ? 'primary' : 'ghost'}
              size="sm"
              disabled={serverPhase !== 'PAUSED' || isBusy}
              loading={isBusyAction('resume')}
              onClick={() => void run('resume')}
            >
              <RotateCcw className="size-3.5" /> RESUME
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={
                serverPhase === 'LOBBY' ||
                serverPhase === 'MARKET_CLOSED' ||
                serverPhase === 'FINAL_SCORING' ||
                serverPhase === 'COMPLETED' ||
                isBusy
              }
              loading={isBusyAction('close-market')}
              onClick={() => setConfirmAction('close-market')}
            >
              <Scale className="size-3.5" /> CLOSE MARKET
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={!canEndGame || isBusy}
              loading={isBusyAction('finalize')}
              onClick={() => setConfirmAction('finalize')}
            >
              <Flag className="size-3.5" /> END GAME
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={serverPhase !== 'COMPLETED' || isBusy}
              loading={isBusyAction('reset')}
              onClick={() => setConfirmAction('reset')}
            >
              <AlertTriangle className="size-3.5" /> RESET ROUND
            </Button>
          </div>
        </div>
      </div>

      {/* ── Teams summary ─────────────────────────────────────────────────── */}
      <div>
        <div className="mb-2 flex items-center justify-between gap-3">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-widest text-fg-muted">
            <Users className="size-4" aria-hidden /> TEAMS
          </h3>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
          <Stat label="Registered" value={registered} icon={<Users className="size-3.5" />} />
          <Stat label="Capacity" value={`${registered}/${meta?.maxTeams ?? '—'}`} icon={<ListX className="size-3.5" />} />
          <Stat label="Connected" value={connectedPlayers} icon={<Wifi className="size-3.5" />} accent="positive" />
          <Stat label="Offline" value={offlinePlayers} icon={<WifiOff className="size-3.5" />} accent="negative" />
          <Stat label="Active" value={activeTeams} icon={<Trophy className="size-3.5" />} accent="info" />
        </div>
      </div>

      {/* ── Economy / activity summary ───────────────────────────────────── */}
      <div>
        <div className="mb-2 flex items-center justify-between gap-3">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-widest text-fg-muted">
            <Coins className="size-4" aria-hidden /> ECONOMY
          </h3>
          <span className="text-[11px] text-fg-muted">server-counted totals</span>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
          <Stat label="Transactions" value={transactions.length} icon={<Coins className="size-3.5" />} hint={transactions.length >= 500 ? 'ledger cap 500' : undefined} />
          <Stat label="Purchases" value={economy.purchases} icon={<Sprout className="size-3.5" />} accent="info" />
          <Stat label="Solves" value={economy.solves} icon={<Trophy className="size-3.5" />} accent="positive" />
          <Stat label="Fails" value={economy.fails} icon={<AlertTriangle className="size-3.5" />} accent="negative" />
          <Stat label="Trades" value={economy.trades} icon={<Scale className="size-3.5" />} accent="warn" />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ── Recent activity (live feed) ────────────────────────────────── */}
        <Card>
          <CardBody className="pt-2">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-widest text-fg-muted">
                <Activity className="size-4" aria-hidden /> RECENT ACTIVITY
              </h3>
              <span className="text-[11px] text-fg-muted">{activity.length} events · seq {lastEventSeq}</span>
            </div>
            {activity.length === 0 ? (
              <EmptyState title="No activity yet" body="Events appear here as teams join, buy, solve, and trade." />
            ) : (
              <div className="space-y-2">
                {activity.slice(0, 8).map((a, i) => (
                  <div key={i} className="flex items-center justify-between gap-3 text-xs">
                    <span className="text-fg">{a.message}</span>
                    <span className="shrink-0 text-fg-muted font-mono" title={`seq ${a.seq}`}>
                      {timeAgo(a.at)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        {/* ── Leaderboard ranking summary ────────────────────────────────── */}
        <Card>
          <CardBody className="pt-2">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-widest text-fg-muted">
                <Trophy className="size-4" aria-hidden /> RANKING
              </h3>
              <span className="text-[11px] text-fg-muted">top {Math.min(leaderboard.length, 8)}</span>
            </div>
            {leaderboard.length === 0 ? (
              <EmptyState title="No teams yet" body="Leaderboard populates when teams join." />
            ) : (
              <div className="space-y-2">
                {leaderboard.slice(0, 8).map((r) => (
                  <div key={r.id} className="flex items-center justify-between gap-3 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="w-8 text-center font-mono font-bold text-fg-muted">{r.rank}</span>
                      <span className={`truncate font-medium ${r.score > 0 ? 'text-fg' : 'text-fg-muted'}`}>{r.teamName}</span>
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

      {/* ── Confirmation for destructive lifecycle actions ─────────────── */}
      <Modal
        open={confirmAction !== null}
        onClose={() => {
          if (!isBusy) setConfirmAction(null);
        }}
        title={confirmAction ? CONFIRM_META[confirmAction].title : ''}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmAction(null)} disabled={isBusy}>
              CANCEL
            </Button>
            <Button
              variant="danger"
              onClick={() => void confirmAndRun()}
              loading={confirmAction !== null && isBusyAction(confirmAction)}
              disabled={isBusy}
            >
              {confirmAction ? CONFIRM_META[confirmAction].confirmLabel : 'CONFIRM'}
            </Button>
          </>
        }
      >
        {confirmAction && <p className="text-sm text-fg-muted">{CONFIRM_META[confirmAction].body}</p>}
      </Modal>
    </div>
  );
}
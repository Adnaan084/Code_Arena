/**
 * H3 — Host RECENT ACTIVITY feed with structured submission emphasis.
 *
 * The generic feed keeps working exactly as before (message + recency); solve
 * and fail events additionally render their structured fields so the host
 * immediately sees "Team Alpha solved Q017 (+200)" or "Team Beta failed Q017"
 * without parsing the human-readable line.
 */
import { CheckCircle2, XCircle, Activity } from 'lucide-react';
import { Card, CardBody, EmptyState } from '../../components/ui';
import { useHostStore } from '../../stores/host';
import { formatCoins, timeAgo } from '../../lib/format';
import type { ActivityDto } from '@wcc/shared';

function ActivityLine({ a }: { a: ActivityDto }) {
  const isSolved = a.type === 'QUESTION_SOLVED';
  const isFailed = a.type === 'QUESTION_FAILED';

  if (isSolved || isFailed) {
    const Icon = isSolved ? CheckCircle2 : XCircle;
    const tone = isSolved ? 'text-emerald-400' : 'text-rose-400';
    return (
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="flex min-w-0 items-center gap-2 text-fg">
          <Icon className={`size-3.5 shrink-0 ${tone}`} aria-hidden />
          <span className="truncate">
            <span className="font-semibold">{a.teamName ?? 'A team'}</span>
            <span> {isSolved ? 'solved' : 'failed'} </span>
            <span className="font-mono font-semibold">{a.questionCode ?? '—'}</span>
            {isSolved && a.coinsAwarded ? (
              <span className={`ml-1 font-semibold ${tone}`}>+{formatCoins(a.coinsAwarded)}</span>
            ) : null}
          </span>
        </span>
        <span className="shrink-0 font-mono text-fg-muted" title={`seq ${a.seq}`}>
          {timeAgo(a.at)}
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="min-w-0 truncate text-fg">{a.message}</span>
      <span className="shrink-0 text-fg-muted font-mono" title={`seq ${a.seq}`}>
        {timeAgo(a.at)}
      </span>
    </div>
  );
}

export function ActivityFeed() {
  const activity = useHostStore((s) => s.activity);
  const lastEventSeq = useHostStore((s) => s.lastEventSeq);

  return (
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
            {activity.slice(-8).reverse().map((a) => (
              <ActivityLine key={a.seq} a={a} />
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
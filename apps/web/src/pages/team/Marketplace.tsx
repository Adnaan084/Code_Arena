import { ShoppingCart, Lock, ArrowRight } from 'lucide-react';
import { Card, CardBody, Badge, Button, EmptyState, Spinner } from '../../components/ui';
import { useTeamStore } from '../../stores/team';
import { api } from '../../lib/api';
import { useAuthStore } from '../../stores/auth';
import { toast } from '../../stores/toasts';
import { friendlyError } from '../../lib/errorMessages';
import { newIdempotencyKey } from '../../lib/api';
import { formatCoins } from '../../lib/format';
import { DIFFICULTY_TONE, QUESTION_TYPE_LABEL } from '../../lib/format';

/** Marketplace: browse and buy questions. */
export function TeamMarketplace() {
  const { teamToken } = useAuthStore();
  const marketplace = useTeamStore((s) => s.marketplace);
  const meta = useTeamStore((s) => s.meta);
  const [buying, setBuying] = useState<string | null>(null);

  const phase = meta?.phase;
  const canBuy = phase?.canBuy ?? false;

  const handleBuy = async (q: typeof marketplace[0]) => {
    if (!canBuy) {
      toast.error('Market closed', 'The marketplace is not open right now.');
      return;
    }
    setBuying(q.id);
    try {
      await api.purchaseQuestion(teamToken ?? '', q.id, newIdempotencyKey());
      toast.success('Purchased!', `${q.code} added to your inventory.`);
    } catch (err) {
      const { message } = friendlyError(err);
      toast.error('Purchase failed', message);
    } finally {
      setBuying(null);
    }
  };

  if (marketplace.length === 0) {
    return (
      <EmptyState
        title="No questions available"
        body={meta?.state === 'LOBBY' ? 'The host hasn\'t added questions yet.' : 'All questions are sold or the market is closed.'}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-fg-muted">MARKETPLACE ({marketplace.length})</h2>
        {!canBuy && meta?.state !== 'LOBBY' && (
          <Badge tone="warn">Market Closed</Badge>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {marketplace.map((q) => (
          <Card key={q.id} className="flex flex-col">
            <CardBody className="flex-1 flex flex-col p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <Badge tone={DIFFICULTY_TONE[q.difficulty] as any}>{q.difficulty}</Badge>
                    <span className="font-mono text-xs font-bold text-fg">{q.code}</span>
                  </div>
                  <div className="mt-1 text-sm font-medium text-fg truncate">{q.title}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-fg-muted">
                    <span>{QUESTION_TYPE_LABEL[q.type]}</span>
                    <span>•</span>
                    <span>{q.category}</span>
                  </div>
                </div>
              </div>

              <div className="mt-auto flex items-center justify-between gap-3 pt-2 border-t border-ink-700/50">
                <div className="flex items-center gap-1">
                  <span className="font-mono text-xl font-bold tabular-nums text-warn">{formatCoins(q.price)}</span>
                  <span className="text-xs text-fg-muted">coins</span>
                </div>
                <div className="flex items-center gap-1 text-[11px] text-fg-muted">
                  <span>Reward: </span>
                  <span className="font-mono font-bold text-positive">{formatCoins(q.reward)}</span>
                </div>
              </div>

              <div className="mt-2">
                <Button
                  variant={q.purchasedByMe ? 'secondary' : canBuy && !q.purchasedByMe ? 'primary' : 'secondary'}
                  size="sm"
                  full
                  loading={buying === q.id}
                  disabled={buying !== null || !canBuy || q.purchasedByMe || q.status === 'SOLD'}
                  onClick={() => handleBuy(q)}
                >
                  {q.purchasedByMe ? (
                    <>OWNED <ArrowRight className="size-3.5" /></>
                  ) : q.status === 'SOLD' ? (
                    'SOLD'
                  ) : !canBuy ? (
                    'MARKET CLOSED'
                  ) : (
                    <>BUY <ShoppingCart className="size-3.5" /></>
                  )}
                </Button>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}

import { useState } from 'react';
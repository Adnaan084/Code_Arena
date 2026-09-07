import { useState } from 'react';
import { ArrowUpRight, ArrowDownLeft, X } from 'lucide-react';
import { Card, CardBody, Badge, Button, EmptyState, Tabs, TabList, Tab, TabPanels, TabPanel } from '../../components/ui';
import { useTeamStore } from '../../stores/team';
import { useAuthStore } from '../../stores/auth';
import { api, newIdempotencyKey } from '../../lib/api';
import { friendlyError } from '../../lib/errorMessages';
import { toast } from '../../stores/toasts';
import { formatCoins, formatTime, DIFFICULTY_BADGE_TONE } from '../../lib/format';

type Trade = ReturnType<typeof import('../../stores/team').useTeamStore.getState>['trades'][0];
type ResolveAction = 'accept' | 'reject' | 'cancel';

/** Trade center: incoming / outgoing / history. After any action, the socket
 *  resync (`game:event` → `state:sync`) replaces the trades array — the server
 *  stays the only authority on ownership, coins and trade state. */
export function TeamTrades() {
  const trades = useTeamStore((s) => s.trades);
  const { teamToken } = useAuthStore();
  const [filter, setFilter] = useState<'IN' | 'OUT' | 'ALL'>('IN');
  const [busy, setBusy] = useState<{ id: string; action: ResolveAction } | null>(null);

  const incoming = trades.filter((t) => t.direction === 'IN' && t.state === 'OPEN');
  const outgoing = trades.filter((t) => t.direction === 'OUT' && t.state === 'OPEN');
  const history = trades.filter((t) => t.state !== 'OPEN');

  const handleResolve = async (tradeId: string, action: ResolveAction) => {
    if (!teamToken || busy) return;
    setBusy({ id: tradeId, action });
    try {
      await api.resolveTrade(teamToken, tradeId, action, newIdempotencyKey());
      toast.success(
        action === 'accept' ? 'Trade accepted' : action === 'reject' ? 'Trade rejected' : 'Trade cancelled',
        action === 'accept' ? 'Ownership and coins will settle automatically.' : 'The offer is closed.',
      );
    } catch (err) {
      const { message } = friendlyError(err);
      toast.error(
        action === 'accept' ? 'Could not accept' : action === 'reject' ? 'Could not reject' : 'Could not cancel',
        message,
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-fg-muted">TRADE CENTER</h2>
        <Tabs value={filter} onValueChange={setFilter} className="w-full">
          <TabList className="grid w-full grid-cols-3">
            <Tab value="IN" className="text-[11px]">INCOMING ({incoming.length})</Tab>
            <Tab value="OUT" className="text-[11px]">OUTGOING ({outgoing.length})</Tab>
            <Tab value="ALL" className="text-[11px]">HISTORY ({history.length})</Tab>
          </TabList>
          <TabPanels value={filter}>
            <TabPanel value="IN">
              {incoming.length === 0 ? (
                <EmptyState title="No incoming offers" body="When another team proposes a trade, it appears here." />
              ) : (
                <div className="space-y-2">
                  {incoming.map((t) => (
                    <TradeCard key={t.id} trade={t} type="in" busy={busy} onResolve={handleResolve} />
                  ))}
                </div>
              )}
            </TabPanel>
            <TabPanel value="OUT">
              {outgoing.length === 0 ? (
                <EmptyState title="No outgoing offers" body="Create a trade from the inventory." />
              ) : (
                <div className="space-y-2">
                  {outgoing.map((t) => (
                    <TradeCard key={t.id} trade={t} type="out" busy={busy} onResolve={handleResolve} />
                  ))}
                </div>
              )}
            </TabPanel>
            <TabPanel value="ALL">
              {history.length === 0 ? (
                <EmptyState title="No trade history" body="Completed, rejected, cancelled and expired trades appear here." />
              ) : (
                <div className="space-y-2">
                  {history.map((t) => (
                    <TradeCard key={t.id} trade={t} type="history" busy={busy} onResolve={handleResolve} />
                  ))}
                </div>
              )}
            </TabPanel>
          </TabPanels>
        </Tabs>
      </div>
    </div>
  );
}

function TradeCard({
  trade,
  type,
  busy,
  onResolve,
}: {
  trade: Trade;
  type: 'in' | 'out' | 'history';
  busy: { id: string; action: ResolveAction } | null;
  onResolve: (id: string, action: ResolveAction) => void;
}) {
  const stateTone = {
    OPEN: 'muted' as const,
    EXECUTED: 'positive' as const,
    REJECTED: 'negative' as const,
    CANCELLED: 'warn' as const,
    EXPIRED: 'warn' as const,
  }[trade.state];

  const isBusy = busy?.id === trade.id;

  return (
    <Card>
      <CardBody className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Badge tone={stateTone}>{trade.state}</Badge>
              <span className="font-mono text-xs text-fg-muted">#{trade.id.slice(0, 8)}</span>
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-sm text-fg-muted">
              <span className="font-semibold text-fg">
                {type === 'in' ? trade.fromTeam.name : trade.toTeam.name}
              </span>
              <span>{type === 'in' ? '→' : '←'}</span>
              <span>{type === 'in' ? trade.toTeam.name : trade.fromTeam.name}</span>
            </div>
            <div className="mt-1 text-[11px] text-fg-muted">
              Offered {formatTime(trade.createdAt)} · expires {formatTime(trade.expiresAt)}
            </div>
          </div>

          {trade.coins !== 0 && (
            <div className="text-right">
              <div className={`font-mono text-lg font-bold ${trade.coins > 0 ? 'text-positive' : 'text-negative'}`}>
                {trade.coins > 0 ? '+' : ''}{formatCoins(trade.coins)}
              </div>
              <div className="text-[10px] text-fg-muted">COINS</div>
            </div>
          )}
        </div>

        <div className="mt-2 grid gap-1.5 text-[11px]">
          <div className="flex items-center gap-1.5 text-fg-muted">
            <ArrowUpRight className="size-3" />
            <span>Offered:</span>
            {trade.offered.map((q) => (
              <Badge key={q.id} tone={DIFFICULTY_BADGE_TONE[q.difficulty]} className="ml-1">
                {q.code}
              </Badge>
            ))}
          </div>
          <div className="flex items-center gap-1.5 text-fg-muted">
            <ArrowDownLeft className="size-3" />
            <span>Requested:</span>
            {trade.requested.map((q) => (
              <Badge key={q.id} tone={DIFFICULTY_BADGE_TONE[q.difficulty]} className="ml-1">
                {q.code}
              </Badge>
            ))}
          </div>
        </div>

        {type === 'in' && trade.state === 'OPEN' && (
          <div className="mt-3 flex gap-2">
            <Button
              variant="success"
              size="sm"
              className="flex-1"
              disabled={isBusy}
              loading={isBusy && busy?.action === 'accept'}
              onClick={() => onResolve(trade.id, 'accept')}
            >
              ACCEPT
            </Button>
            <Button
              variant="danger"
              size="sm"
              className="flex-1"
              disabled={isBusy}
              loading={isBusy && busy?.action === 'reject'}
              onClick={() => onResolve(trade.id, 'reject')}
            >
              REJECT
            </Button>
          </div>
        )}
        {type === 'out' && trade.state === 'OPEN' && (
          <div className="mt-3">
            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              disabled={isBusy}
              loading={isBusy && busy?.action === 'cancel'}
              onClick={() => onResolve(trade.id, 'cancel')}
            >
              <X className="size-3.5" />
              CANCEL
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
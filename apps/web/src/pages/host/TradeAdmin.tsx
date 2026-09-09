import { useState } from 'react';
import { ArrowRightLeft, ArrowUpRight, ArrowDownLeft, X } from 'lucide-react';
import { Card, CardBody, Badge, Button, Modal, FormField, TextInput, EmptyState, Tabs, TabList, Tab, TabPanels, TabPanel } from '../../components/ui';
import { useHostStore } from '../../stores/host';
import { useHostAction } from '../../hooks/useHostAction';
import { useHostReady, readinessTitle } from '../../hooks/useHostReady';
import { useConnectionStore } from '../../stores/connection';
import { formatCoins, formatTime, DIFFICULTY_BADGE_TONE } from '../../lib/format';
import type { TradeDto, TradeState } from '@wcc/shared';

/**
 * H2-C — Host trade administration.
 *
 * Lists every trade in the game (active + history) straight from the
 * server-authoritative host snapshot. Each card names the source team (the
 * OF FERING side) and target team (the RECEIVING side) explicitly — From→To is
 * never ambiguous because the two team names are read from fromTeam/toTeam of
 * the shared TradeDto, never from the team-viewer `direction` field.
 *
 * Cancellation goes through the existing host REST endpoint via useHostAction
 * (backend-authoritative: cancelTradeAdmin only cancels OPEN trades, audits the
 * action with the host-supplied reason and broadcasts TRADE_CANCELLED). The UI
 * disables CANCEL for non-OPEN trades as a hint, but the backend remains the
 * final authority and its rejection surfaces as the normal error toast.
 */

const STATE_TONE: Record<TradeState, 'muted' | 'positive' | 'warn' | 'negative'> = {
  OPEN: 'muted',
  EXECUTED: 'positive',
  REJECTED: 'negative',
  CANCELLED: 'warn',
  EXPIRED: 'warn',
};

export function TradeAdmin() {
  const trades = useHostStore((s) => s.trades);
  const { cancelTrade, isBusy, isBusyAction } = useHostAction();
  const ready = useHostReady();
  const status = useConnectionStore((s) => s.status);

  const [filter, setFilter] = useState<'ACTIVE' | 'HISTORY'>('ACTIVE');
  const [modal, setModal] = useState<TradeDto | null>(null);
  // Optional admin note recorded in the audit trail alongside the cancellation.
  const [reason, setReason] = useState('');

  const active = trades.filter((t) => t.state === 'OPEN');
  const history = trades.filter((t) => t.state !== 'OPEN');

  const openModal = (trade: TradeDto) => {
    setReason('');
    setModal(trade);
  };

  const submitCancel = async () => {
    if (!modal) return;
    const result = await cancelTrade(modal.id, reason.trim());
    if (result.ok) setModal(null); // stay open on failure so the host can retry/cancel
  };

  return (
    <div className="space-y-3">
      {/* Tabs root wraps BOTH the pill row and the panels — TabPanel reads the
          active value from this provider, so the panel must be a descendant. */}
      <Tabs value={filter} onValueChange={setFilter}>
        <div className="mb-2 flex items-center justify-between gap-3">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-widest text-fg-muted">
            <ArrowRightLeft className="size-4" aria-hidden /> TRADE ADMINISTRATION
          </h3>
          <TabList className="grid w-full max-w-xs grid-cols-2">
            <Tab value="ACTIVE" className="text-[11px]">ACTIVE TRADES ({active.length})</Tab>
            <Tab value="HISTORY" className="text-[11px]">HISTORY ({history.length})</Tab>
          </TabList>
        </div>
        <TabPanels value={filter}>
          <TabPanel value="ACTIVE">
            {active.length === 0 ? (
              <EmptyState title="No active trades" body="Pending trade offers appear here. You can cancel a pending trade if needed." />
            ) : (
              <div className="space-y-2">
                {active.map((t) => (
                  <TradeCard key={t.id} trade={t} onCancel={() => openModal(t)} canCancel ready={ready} status={status} />
                ))}
              </div>
            )}
          </TabPanel>
          <TabPanel value="HISTORY">
            {history.length === 0 ? (
              <EmptyState title="No trade history" body="Executed, rejected, cancelled and expired trades appear here." />
            ) : (
              <div className="space-y-2">
                {history.map((t) => (
                  <TradeCard key={t.id} trade={t} onCancel={() => openModal(t)} />
                ))}
              </div>
            )}
          </TabPanel>
        </TabPanels>
      </Tabs>

      {/* ── Cancel-trade confirmation ───────────────────────────────────── */}
      <Modal
        open={modal !== null}
        onClose={() => !isBusy && setModal(null)}
        title="CANCEL TRADE?"
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setModal(null)} disabled={isBusy}>
              CANCEL
            </Button>
            <Button variant="danger" onClick={() => void submitCancel()} loading={isBusyAction('cancel-trade')} disabled={isBusy}>
              CANCEL TRADE
            </Button>
          </>
        }
      >
        {modal && (
          <div className="space-y-3">
            <p className="text-sm text-fg-muted">
              Cancel the pending trade{' '}
              <span className="font-mono text-fg">#{modal.id.slice(0, 8)}</span>
              {' '}where{' '}
              <span className="font-semibold text-fg">{modal.fromTeam.name}</span> gives{' '}
              {modal.offered.map((q) => q.code).join(', ') || '—'}
              {' '}to{' '}
              <span className="font-semibold text-fg">{modal.toTeam.name}</span>{' '}
              in exchange for{' '}
              {modal.requested.map((q) => q.code).join(', ') || '—'}
              {modal.coins > 0 ? <> plus {formatCoins(modal.coins)} coins</> : ''}.
              Both teams are notified and the questions are released from their trade lock.
            </p>
            <FormField label="Reason (optional)" htmlFor="cancel-trade-reason" hint="Recorded in the audit log with this action.">
              <TextInput
                id="cancel-trade-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. disputed offer"
                maxLength={200}
              />
            </FormField>
          </div>
        )}
      </Modal>
    </div>
  );
}

function TradeCard({
  trade,
  canCancel = false,
  onCancel,
  ready = true,
  status = 'connected',
}: {
  trade: TradeDto;
  canCancel?: boolean;
  onCancel: () => void;
  ready?: boolean;
  status?: string;
}) {
  return (
    <Card>
      <CardBody className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Badge tone={STATE_TONE[trade.state]}>{trade.state}</Badge>
              <span className="font-mono text-xs text-fg-muted">#{trade.id.slice(0, 8)}</span>
            </div>

            {/* Direction is explicit: FROM = offering side, TO = receiving side. */}
            <div className="mt-1.5 flex items-center gap-1.5 text-sm text-fg-muted">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-fg-faint">From</span>
              <span className="font-semibold text-fg">{trade.fromTeam.name}</span>
              <span className="text-fg-faint">→</span>
              <span className="text-[10px] font-semibold uppercase tracking-widest text-fg-faint">To</span>
              <span className="font-semibold text-fg">{trade.toTeam.name}</span>
            </div>

            <div className="mt-1.5 grid gap-1 text-[11px]">
              <div className="flex items-center gap-1.5 text-fg-muted">
                <ArrowUpRight className="size-3" />
                <span className="uppercase tracking-widest text-fg-faint">gives</span>
                {trade.offered.map((q) => (
                  <Badge key={q.id} tone={DIFFICULTY_BADGE_TONE[q.difficulty]}>
                    {q.code}
                  </Badge>
                ))}
              </div>
              <div className="flex items-center gap-1.5 text-fg-muted">
                <ArrowDownLeft className="size-3" />
                <span className="uppercase tracking-widest text-fg-faint">wants</span>
                {trade.requested.map((q) => (
                  <Badge key={q.id} tone={DIFFICULTY_BADGE_TONE[q.difficulty]}>
                    {q.code}
                  </Badge>
                ))}
              </div>
            </div>
          </div>

          <div className="shrink-0 text-right">
            {trade.coins > 0 && (
              <div>
                <div className="font-mono text-lg font-bold text-warn">{formatCoins(trade.coins)}</div>
                <div className="text-[10px] text-fg-muted">COINS</div>
              </div>
            )}
            {canCancel && (
              <Button
                variant="danger"
                size="sm"
                className="mt-2"
                disabled={!ready}
                title={readinessTitle(status as any, ready) ?? undefined}
                onClick={onCancel}
              >
                <X className="size-3.5" /> CANCEL
              </Button>
            )}
          </div>
        </div>

        <div className="mt-1.5 text-[10px] text-fg-muted font-mono">
          created {formatTime(trade.createdAt)} · expires {formatTime(trade.expiresAt)}
        </div>
      </CardBody>
    </Card>
  );
}
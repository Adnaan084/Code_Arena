import { useMemo, useState } from 'react';
import { ShieldCheck, Undo2, UserX, ArrowDownToLine, ArrowUpFromLine } from 'lucide-react';
import { Card, CardBody, Badge, Button, Modal, FormField, TextInput, EmptyState } from '../../components/ui';
import { useHostStore } from '../../stores/host';
import { useHostAction } from '../../hooks/useHostAction';
import { formatCoins } from '../../lib/format';
import type { HostPurchase, TeamSummary } from '@wcc/shared';

/**
 * H2-B — Host team administration + economy controls.
 *
 * Every action goes through the real host REST endpoints via useHostAction;
 * the UI never mutates a wallet locally. Destructive/admin actions are gated by
 * an explicit confirmation modal that names the target team unambiguously.
 * State (balances, scores, status) is read from the server-authoritative host
 * snapshot in the store and updates through the post-action socket resync.
 */

type AdminModal =
  | { kind: 'disqualify'; team: TeamSummary }
  | { kind: 'coins'; team: TeamSummary; sign: 1 | -1 }
  | { kind: 'refund'; team: TeamSummary }
  | null;

const TEAM_TONE = { ACTIVE: 'positive', DISQUALIFIED: 'negative' } as const;

export function TeamAdmin() {
  const teams = useHostStore((s) => s.teams);
  const purchases = useHostStore((s) => s.purchases);
  const connectedCount = useHostStore((s) => s.connectedCount);

  const { disqualify, reinstate, adjustCoins, refund, isBusy, isBusyAction } = useHostAction();

  const [modal, setModal] = useState<AdminModal>(null);

  // ── Coin adjustment form state (reset each time the modal opens) ─────────
  const [coinAmount, setCoinAmount] = useState('');
  const [coinReason, setCoinReason] = useState('');
  const [disqReason, setDisqReason] = useState('');
  const [refundQuestionId, setRefundQuestionId] = useState('');
  const [refundReason, setRefundReason] = useState('');

  const refundable = useMemo(() => {
    if (!modal || modal.kind !== 'refund') return [];
    return purchases.filter((p) => p.teamId === modal.team.id && p.status !== 'SOLVED');
  }, [modal, purchases]);

  // Frontend guards mirror the API contract (amount != 0 integer; reason ≥ 3)
  // without duplicating wallet rules — the server stays authoritative for
  // balance, so an oversized REMOVE is allowed through and rejected there.
  const coinAmountNum = Number(coinAmount);
  const coinValid =
    Number.isInteger(coinAmountNum) && coinAmountNum > 0 && coinReason.trim().length >= 3;
  const refundValid = !!refundQuestionId && refundReason.trim().length >= 3;

  const openModal = (m: AdminModal) => {
    setCoinAmount('');
    setCoinReason('');
    setDisqReason('');
    setRefundQuestionId('');
    setRefundReason('');
    setModal(m);
  };

  const submitDisqualify = async () => {
    if (!modal || modal.kind !== 'disqualify') return;
    const result = await disqualify(modal.team.id, disqReason.trim() || undefined);
    if (result.ok) setModal(null); // stay open on failure so the host can retry/cancel
  };

  const submitCoins = async () => {
    if (!modal || modal.kind !== 'coins' || !coinValid) return;
    const result = await adjustCoins(modal.team.id, modal.sign * coinAmountNum, coinReason);
    if (result.ok) setModal(null);
  };

  const submitRefund = async () => {
    if (!modal || modal.kind !== 'refund' || !refundValid) return;
    const result = await refund(modal.team.id, refundQuestionId, refundReason);
    if (result.ok) setModal(null);
  };

  if (teams.length === 0) {
    return (
      <Card>
        <CardBody>
          <EmptyState
            title="No teams yet"
            body="Teams appear here as players register. You can disqualify, reinstate, or adjust a team's economy once it has joined."
          />
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {teams.map((t) => {
        const disqualified = t.status === 'DISQUALIFIED';
        return (
          <Card key={t.id}>
            <CardBody className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <Badge tone={TEAM_TONE[t.status] ?? 'muted'}>{t.status}</Badge>
                  <span className="truncate font-semibold text-fg">{t.name}</span>
                  <span className="font-mono text-[11px] text-fg-faint">#{t.joinOrder}</span>
                </div>
                <div className="flex items-center gap-4 text-[11px] text-fg-muted">
                  <span className="font-mono text-warn">BAL {formatCoins(t.coins)}</span>
                  <span className="font-mono">SCORE {t.score}</span>
                  <span>{t.purchasedCount} bought</span>
                  <span>{connectedCount(t.id) ?? (t.online ? 1 : 0)} online</span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {disqualified ? (
                  <Button
                    variant="success"
                    size="sm"
                    disabled={isBusy}
                    loading={isBusyAction('reinstate')}
                    onClick={() => void reinstate(t.id)}
                  >
                    <ShieldCheck className="size-3.5" /> REINSTATE
                  </Button>
                ) : (
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={isBusy}
                    loading={isBusyAction('disqualify')}
                    onClick={() => openModal({ kind: 'disqualify', team: t })}
                  >
                    <UserX className="size-3.5" /> DISQUALIFY
                  </Button>
                )}

                <Button
                  variant="ghost"
                  size="sm"
                  disabled={isBusy}
                  loading={isBusyAction('adjust-coins')}
                  onClick={() => openModal({ kind: 'coins', team: t, sign: -1 })}
                >
                  <ArrowDownToLine className="size-3.5" /> REMOVE COINS
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={isBusy}
                  loading={isBusyAction('adjust-coins')}
                  onClick={() => openModal({ kind: 'coins', team: t, sign: 1 })}
                >
                  <ArrowUpFromLine className="size-3.5" /> ADD COINS
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={isBusy}
                  loading={isBusyAction('refund')}
                  onClick={() => openModal({ kind: 'refund', team: t })}
                >
                  <Undo2 className="size-3.5" /> REFUND
                </Button>
              </div>
            </CardBody>
          </Card>
        );
      })}

      {/* ── Disqualify confirmation ─────────────────────────────────────── */}
      <Modal
        open={modal?.kind === 'disqualify'}
        onClose={() => !isBusy && setModal(null)}
        title="DISQUALIFY TEAM?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setModal(null)} disabled={isBusy}>
              CANCEL
            </Button>
            <Button variant="danger" onClick={() => void submitDisqualify()} loading={isBusyAction('disqualify')} disabled={isBusy}>
              DISQUALIFY
            </Button>
          </>
        }
      >
        {modal?.kind === 'disqualify' && (
          <div className="space-y-3">
            <p className="text-sm text-fg-muted">
              This immediately disqualifies{' '}
              <span className="font-semibold text-fg">
                {modal.team.name} #{modal.team.joinOrder}
              </span>
              . The team is marked <span className="font-semibold text-negative">DISQUALIFIED</span>, removed from the
              leaderboard, and can no longer participate. Their coins and purchases are preserved.
            </p>
            <FormField label="Reason (optional)" htmlFor="disq-reason">
              <TextInput
                id="disq-reason"
                value={disqReason}
                onChange={(e) => setDisqReason(e.target.value)}
                placeholder="e.g. unfair cooperation"
                maxLength={200}
              />
            </FormField>
          </div>
        )}
      </Modal>

      {/* ── Coin adjustment (add / remove) ──────────────────────────────── */}
      <Modal
        open={modal?.kind === 'coins'}
        onClose={() => !isBusy && setModal(null)}
        title={modal?.kind === 'coins' ? (modal.sign === 1 ? 'ADD COINS' : 'REMOVE COINS') : ''}
        footer={
          <>
            <Button variant="ghost" onClick={() => setModal(null)} disabled={isBusy}>
              CANCEL
            </Button>
            <Button variant="danger" onClick={() => void submitCoins()} loading={isBusyAction('adjust-coins')} disabled={isBusy || !coinValid}>
              {modal?.kind === 'coins' ? (modal.sign === 1 ? 'ADD COINS' : 'REMOVE COINS') : 'CONFIRM'}
            </Button>
          </>
        }
      >
        {modal?.kind === 'coins' && (
          <div className="space-y-3">
            <p className="text-sm text-fg-muted">
              Adjust the wallet of{' '}
              <span className="font-semibold text-fg">
                {modal.team.name} #{modal.team.joinOrder}
              </span>
              . Current balance:{' '}
              <span className="font-mono font-semibold text-warn">{formatCoins(modal.team.coins)}</span>.
            </p>
            <FormField label={`Amount to ${modal.sign === 1 ? 'add' : 'remove'}`} htmlFor="coin-amount" hint="Whole coins only. The server rejects adjustments that would go negative.">
              <TextInput
                id="coin-amount"
                type="number"
                min={1}
                max={1_000_000}
                value={coinAmount}
                onChange={(e) => setCoinAmount(e.target.value)}
                placeholder="0"
              />
            </FormField>
            <FormField label="Reason (required)" htmlFor="coin-reason" error={coinReason.trim().length > 0 && coinReason.trim().length < 3 ? 'Reason must be at least 3 characters.' : null}>
              <TextInput
                id="coin-reason"
                value={coinReason}
                onChange={(e) => setCoinReason(e.target.value)}
                placeholder="e.g. tournament adjustment"
                maxLength={200}
              />
            </FormField>
          </div>
        )}
      </Modal>

      {/* ── Refund confirmation ─────────────────────────────────────────── */}
      <Modal
        open={modal?.kind === 'refund'}
        onClose={() => !isBusy && setModal(null)}
        title="REFUND PURCHASE?"
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setModal(null)} disabled={isBusy}>
              CANCEL
            </Button>
            <Button variant="danger" onClick={() => void submitRefund()} loading={isBusyAction('refund')} disabled={isBusy || !refundValid}>
              REFUND
            </Button>
          </>
        }
      >
        {modal?.kind === 'refund' && (
          <div className="space-y-3">
            <p className="text-sm text-fg-muted">
              Refund a purchase made by{' '}
              <span className="font-semibold text-fg">
                {modal.team.name} #{modal.team.joinOrder}
              </span>
              . Only unsolved purchases can be refunded.
            </p>
            {refundable.length === 0 ? (
              <EmptyState
                title="No refundable purchases"
                body="This team has no unsolved questions to refund. A purchase is refundable until it is solved."
              />
            ) : (
              <FormField label="Purchase to refund" htmlFor="refund-pick">
                <select
                  id="refund-pick"
                  className="h-11 w-full rounded-lg border border-ink-600 bg-ink-850 px-3.5 text-sm text-fg focus:border-accent focus:outline-none"
                  value={refundQuestionId}
                  onChange={(e) => setRefundQuestionId(e.target.value)}
                >
                  <option value="">Select a purchase…</option>
                  {refundable.map((p: HostPurchase) => (
                    <option key={p.questionId} value={p.questionId}>
                      {p.questionCode} — {p.title} ({formatCoins(p.price)}, {p.status})
                    </option>
                  ))}
                </select>
              </FormField>
            )}
            <FormField label="Reason (required)" htmlFor="refund-reason">
              <TextInput
                id="refund-reason"
                value={refundReason}
                onChange={(e) => setRefundReason(e.target.value)}
                placeholder="e.g. duplicate purchase"
                maxLength={200}
              />
            </FormField>
          </div>
        )}
      </Modal>

      </div>
  );
}
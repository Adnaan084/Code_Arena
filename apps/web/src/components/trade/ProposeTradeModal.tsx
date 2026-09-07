import { useEffect, useMemo, useState } from 'react';
import { Coins, Scale } from 'lucide-react';
import { Modal, Button, FormField, TextInput, Badge, EmptyState } from '../ui';
import { useTeamStore } from '../../stores/team';
import { useAuthStore } from '../../stores/auth';
import { api, newIdempotencyKey } from '../../lib/api';
import { friendlyError } from '../../lib/errorMessages';
import { toast } from '../../stores/toasts';
import { formatCoins, DIFFICULTY_BADGE_TONE } from '../../lib/format';
import type { InventoryItem, TradeTarget } from '@wcc/shared';

/**
 * Propose a trade: pick what you offer from your own tradable inventory, pick
 * the target team, pick one of the target's tradable questions to request, and
 * (optionally) sweeten with coins. The server remains authoritative — every
 * constraint (ownership, locks, max trades, phase, coins) is re-checked at
 * propose time, and any rejection surfaces verbatim here.
 */
export function ProposeTradeModal({
  open,
  onClose,
  offered,
}: {
  open: boolean;
  onClose: () => void;
  offered: InventoryItem;
}) {
  const { teamToken } = useAuthStore();
  const team = useTeamStore((s) => s.team);
  const phase = useTeamStore((s) => s.meta?.phase);
  const inventory = useTeamStore((s) => s.inventory);

  const ownTradable = useMemo(
    () => inventory.filter((i) => i.status === 'UNSOLVED' && i.question.maxTrades > i.question.tradeCount),
    [inventory],
  );

  const [targets, setTargets] = useState<TradeTarget[] | null>(null);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [offeredId, setOfferedId] = useState<string | null>(null);
  const [requestedId, setRequestedId] = useState<string | null>(null);
  const [coins, setCoins] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTargets(null);
    setTargetId(null);
    setRequestedId(null);
    setCoins('');
    setSubmitting(false);
    // Default the offer to the question the user clicked TRADE on.
    setOfferedId(offered.question.id);
    api
      .teamTradeTargets(teamToken ?? '')
      .then((ts) => {
        setTargets(ts);
        const pick = ts[0] ?? null;
        setTargetId(pick?.teamId ?? null);
      })
      .catch((err) => {
        const { message } = friendlyError(err);
        toast.error('Cannot load trade options', message);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const target = targets?.find((t) => t.teamId === targetId) ?? null;
  const offeredQuestion = ownTradable.find((i) => i.question.id === offeredId)?.question ?? null;
  const requestedQuestion = target?.tradable.find((q) => q.id === requestedId) ?? null;

  const coinVal = coins.trim() === '' ? 0 : Number(coins);
  const coinsValid = Number.isFinite(coinVal) && Number.isInteger(coinVal) && coinVal >= 0 && coinVal <= (team?.coins ?? 0);
  const canTrade = phase?.canTrade ?? false;

  const canSubmit =
    canTrade &&
    !submitting &&
    targetId !== null &&
    offeredId !== null &&
    requestedId !== null &&
    requestedId !== offeredId &&
    ownTradable.some((i) => i.question.id === offeredId) &&
    coinsValid;

  const handleTarget = (id: string) => {
    setTargetId(id);
    setRequestedId(null); // requested questions are team-specific
  };

  const handleSubmit = async () => {
    if (!canSubmit || !targetId || !offeredId || !requestedId) return;
    setSubmitting(true);
    try {
      await api.createTrade(
        teamToken ?? '',
        { targetTeamId: targetId, offeredQuestionId: offeredId, requestedQuestionId: requestedId, coins: coinVal },
        newIdempotencyKey(),
      );
      toast.success('Trade proposed', 'Your offer is on the table — it stays open until it is accepted, rejected, cancelled, or expires.');
      onClose();
    } catch (err) {
      const { message } = friendlyError(err);
      toast.error('Trade not proposed', message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="PROPOSE TRADE"
      wide
      footer={
        <>
          <Button variant="ghost" size="md" onClick={onClose} disabled={submitting}>
            CANCEL
          </Button>
          <Button variant="primary" size="md" onClick={handleSubmit} disabled={!canSubmit} loading={submitting}>
            <Scale className="size-4" />
            PROPOSE
          </Button>
        </>
      }
    >
      {targets === null ? (
        <p className="py-6 text-center text-sm text-fg-muted">Loading trade options…</p>
      ) : targets.length === 0 ? (
        <EmptyState title="No teams to trade with" body="There are no other active teams in this game." />
      ) : (
        <div className="space-y-4">
          {!canTrade && (
            <p className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
              Trading is currently closed — the host will open it during the market.
            </p>
          )}

          {/* Offer */}
          <div>
            <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-fg-muted">
              <Coins className="size-3.5" />
              You offer
            </div>
            {ownTradable.length === 0 ? (
              <p className="text-xs text-fg-muted">You have no tradable unsolved questions.</p>
            ) : (
              <div className="grid gap-1.5 sm:grid-cols-2">
                {ownTradable.map((i) => {
                  const q = i.question;
                  const selected = q.id === offeredId;
                  return (
                    <button
                      key={i.ownershipId}
                      type="button"
                      onClick={() => setOfferedId(q.id)}
                      aria-pressed={selected}
                      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-colors cursor-pointer ${
                        selected
                          ? 'border-accent bg-accent/10 text-fg'
                          : 'border-ink-600 bg-ink-850 text-fg-muted hover:text-fg hover:border-ink-500'
                      }`}
                    >
                      <Badge tone={DIFFICULTY_BADGE_TONE[q.difficulty]} className="shrink-0">
                        {q.difficulty}
                      </Badge>
                      <span className="min-w-0">
                        <span className="block truncate font-mono font-bold text-fg">{q.code}</span>
                        <span className="block truncate text-fg-faint">{q.title}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            {requestedId !== null && offeredId === requestedId && (
              <p className="mt-1 text-xs text-negative">You can’t offer and request the same question.</p>
            )}
          </div>

          {/* Target team */}
          <div>
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-fg-muted">Trade with</div>
            <div className="flex flex-wrap gap-1.5">
              {targets.map((t) => {
                const selected = t.teamId === targetId;
                return (
                  <button
                    key={t.teamId}
                    type="button"
                    onClick={() => handleTarget(t.teamId)}
                    aria-pressed={selected}
                    disabled={t.tradable.length === 0}
                    title={t.tradable.length === 0 ? `${t.teamName} has nothing to offer right now` : undefined}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer disabled:opacity-40 disabled:pointer-events-none ${
                      selected
                        ? 'border-accent bg-accent/10 text-fg'
                        : 'border-ink-600 bg-ink-850 text-fg-muted hover:text-fg hover:border-ink-500'
                    }`}
                  >
                    {t.teamName}
                    <span className="ml-1.5 text-fg-faint">({t.tradable.length})</span>
                  </button>
                );
              })}
            </div>
            {target && target.tradable.length === 0 && (
              <p className="mt-1 text-xs text-fg-muted">{target.teamName} currently has no questions available to trade.</p>
            )}
          </div>

          {/* Requested */}
          <div>
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-fg-muted">
              Request in return
            </div>
            {!target || target.tradable.length === 0 ? (
              <p className="text-xs text-fg-muted">Select a team with tradable questions to see what you can request.</p>
            ) : (
              <div className="grid gap-1.5 sm:grid-cols-2">
                {target.tradable.map((q) => {
                  const selected = q.id === requestedId;
                  return (
                    <button
                      key={q.id}
                      type="button"
                      onClick={() => setRequestedId(q.id)}
                      aria-pressed={selected}
                      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-colors cursor-pointer ${
                        selected
                          ? 'border-accent bg-accent/10 text-fg'
                          : 'border-ink-600 bg-ink-850 text-fg-muted hover:text-fg hover:border-ink-500'
                      }`}
                    >
                      <Badge tone={DIFFICULTY_BADGE_TONE[q.difficulty]} className="shrink-0">
                        {q.difficulty}
                      </Badge>
                      <span className="min-w-0">
                        <span className="block truncate font-mono font-bold text-fg">{q.code}</span>
                        <span className="block truncate text-fg-faint">{q.title}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Coins sweetener */}
          <FormField
            label="Coin sweetener (coins added on top of the swap)"
            htmlFor="trade-coins"
            error={coins !== '' && !coinsValid ? `Enter 0 – ${formatCoins(team?.coins ?? 0)} (you have ${formatCoins(team?.coins ?? 0)}).` : undefined}
          >
            <TextInput
              id="trade-coins"
              inputMode="numeric"
              placeholder="0"
              value={coins}
              onChange={(e) => setCoins(e.target.value)}
              disabled={submitting}
            />
          </FormField>

          {/* Review */}
          {(offeredQuestion || requestedQuestion) && (
            <div className="rounded-lg border border-ink-600 bg-ink-850 px-3 py-2.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-fg-muted">REVIEW</span>
                <span className="text-fg-muted">→ {target?.teamName ?? '…'}</span>
              </div>
              <div className="mt-1.5 space-y-1 text-fg">
                <div>
                  You give: <span className="font-mono font-bold">{offeredQuestion ? `${offeredQuestion.code}` : '…'}</span>
                  {offeredQuestion && offeredQuestion.reward > 0 && (
                    <span className="text-fg-faint"> (reward {formatCoins(offeredQuestion.reward)})</span>
                  )}
                  <span className="text-fg-muted"> + </span>
                  <span className="font-mono font-bold text-warn">{coinsValid ? formatCoins(coinVal) : '…'}</span>
                  <span className="text-fg-muted"> coins</span>
                </div>
                <div>
                  You get: <span className="font-mono font-bold">{requestedQuestion ? `${requestedQuestion.code}` : '…'}</span>
                  {requestedQuestion && requestedQuestion.reward > 0 && (
                    <span className="text-fg-faint"> (reward {formatCoins(requestedQuestion.reward)})</span>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
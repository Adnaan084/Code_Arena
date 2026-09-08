import { useCallback, useState } from 'react';
import { api } from '../lib/api';
import { requestState } from '../lib/socket';
import { toast } from '../stores/toasts';
import { friendlyError } from '../lib/errorMessages';
import { useAuthStore } from '../stores/auth';

/**
 * Reusable abstraction for host console/administrative actions.
 *
 * Every action calls a real host REST endpoint via the typed API client, then
 * — and only then — asks the socket layer for a fresh authoritative snapshot.
 * The UI never assumes a click succeeded: state returns through the server.
 * Also guards against accidental double-clicks (one action at a time).
 */
const ACTION_LABEL: Record<string, { done: string; fail: string }> = {
  start: { done: 'Game started', fail: 'start the game' },
  pause: { done: 'Game paused', fail: 'pause the game' },
  resume: { done: 'Game resumed', fail: 'resume the game' },
  'close-market': { done: 'Market closed', fail: 'close the market' },
  finalize: { done: 'Game finalized', fail: 'finalize the game' },
  reset: { done: 'Game reset', fail: 'reset the game' },
  // H2-B team administration + economy.
  disqualify: { done: 'Team disqualified', fail: 'disqualify the team' },
  reinstate: { done: 'Team reinstated', fail: 'reinstate the team' },
  'adjust-coins': { done: 'Coins adjusted', fail: 'adjust coins' },
  refund: { done: 'Purchase refunded', fail: 'refund the purchase' },
  // H2-C host trade administration.
  'cancel-trade': { done: 'Trade cancelled', fail: 'cancel the trade' },
};

const FALLBACK_LABEL = { done: 'Action complete', fail: 'run that action' };

export function useHostAction() {
  const hostToken = useAuthStore((s) => s.hostToken);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [lastError, setLastError] = useState<{ code: string; message: string } | null>(null);

  /** Shared execution: guard session + double-click, run the call, then resync. */
  const execute = useCallback(
    async (action: string, call: () => Promise<unknown>): Promise<{ ok: boolean; data: unknown }> => {
      if (!hostToken) {
        const err = { code: 'NO_SESSION', message: 'No host session. Please create a game.' };
        setLastError(err);
        toast.error('No host session', err.message);
        return { ok: false, data: null };
      }
      // Duplicate-click guard: one host action at a time.
      if (busyAction !== null) return { ok: false, data: null };

      const label = ACTION_LABEL[action] ?? FALLBACK_LABEL;
      setBusyAction(action);
      setLastError(null);
      try {
        const data = await call();
        toast.success(label.done);
        // Returning authoritative state, not a local guess: requestState pulls a
        // full state:sync over the live socket; the event that the backend also
        // broadcasts triggers the normal debounced resync as a belt-and-braces.
        requestState();
        return { ok: true, data };
      } catch (err) {
        const friendly = friendlyError(err);
        setLastError(friendly);
        toast.error(`Could not ${label.fail}`, friendly.message);
        return { ok: false, data: null };
      } finally {
        setBusyAction(null);
      }
    },
    [hostToken, busyAction],
  );

  /** Lifecycle action → POST /host/{action} (start, pause, resume, …). */
  const run = useCallback(
    (action: string) => execute(action, () => api.hostAction(hostToken!, action)),
    [execute, hostToken],
  );

  /** Disqualify a team (reason optional). */
  const disqualify = useCallback(
    (teamId: string, reason?: string) =>
      execute('disqualify', () => api.hostDisqualify(hostToken!, teamId, reason)),
    [execute, hostToken],
  );

  /** Reinstate a previously-disqualified team. */
  const reinstate = useCallback(
    (teamId: string) => execute('reinstate', () => api.hostReinstate(hostToken!, teamId)),
    [execute, hostToken],
  );

  /** Adjust a team's coins by a signed amount (must be non-zero; backend authoritative for balance). */
  const adjustCoins = useCallback(
    (teamId: string, amount: number, reason: string) =>
      execute('adjust-coins', () => api.hostAdjustCoins(hostToken!, teamId, amount, reason)),
    [execute, hostToken],
  );

  /** Refund a purchase (teamId + questionId). */
  const refund = useCallback(
    (teamId: string, questionId: string, reason: string) =>
      execute('refund', () => api.hostRefund(hostToken!, teamId, questionId, reason)),
    [execute, hostToken],
  );

  /** Admin-cancel a pending trade (the backend validates it is OPEN). */
  const cancelTrade = useCallback(
    (tradeId: string, reason: string) =>
      execute('cancel-trade', () => api.hostCancelTrade(hostToken!, tradeId, reason)),
    [execute, hostToken],
  );

  const clearError = useCallback(() => setLastError(null), []);

  return {
    run,
    disqualify,
    reinstate,
    adjustCoins,
    refund,
    cancelTrade,
    busyAction,
    /** True while ANY host action is in flight. */
    isBusy: busyAction !== null,
    /** Narrow busy check for per-button loading spinners. */
    isBusyAction: (a: string) => busyAction === a,
    lastError,
    clearError,
  };
}

import { useCallback, useState } from 'react';
import { api } from '../lib/api';
import { requestState } from '../lib/socket';
import { toast } from '../stores/toasts';
import { friendlyError } from '../lib/errorMessages';
import { useAuthStore } from '../stores/auth';

/**
 * Small reusable abstraction for host lifecycle/console actions.
 *
 * Calls the real host REST endpoint via `api.hostAction(token, action)`, then
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
};

const FALLBACK_LABEL = { done: 'Action complete', fail: 'run that action' };

export function useHostAction() {
  const hostToken = useAuthStore((s) => s.hostToken);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [lastError, setLastError] = useState<{ code: string; message: string } | null>(null);

  const run = useCallback(
    async (action: string): Promise<{ ok: boolean; data: unknown }> => {
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
        const data = await api.hostAction(hostToken, action);
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

  const clearError = useCallback(() => setLastError(null), []);

  return {
    run,
    busyAction,
    /** True while ANY host lifecycle action is in flight. */
    isBusy: busyAction !== null,
    /** Narrow busy check for per-button loading spinners. */
    isBusyAction: (a: string) => busyAction === a,
    lastError,
    clearError,
  };
}
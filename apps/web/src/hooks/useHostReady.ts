import { useConnectionStore } from '../stores/connection';
import { useHostStore } from '../stores/host';

/**
 * Host readiness: authoritative state has loaded AND connection is healthy.
 *
 * Distinguishes:
 * - not loaded yet            → hasLoaded === false
 * - loaded + connected        → true
 * - reconnecting/disconnected → false (status !== 'connected')
 * - connected but resyncing   → false (lastSyncGeneration < connectedGeneration,
 *                                   i.e. fresh state:sync hasn't arrived since the reconnect)
 *
 * A reconnect is NOT complete merely because Socket.IO reports 'connected'.
 */
export function useHostReady(): boolean {
  const status = useConnectionStore((s) => s.status);
  const connectedGeneration = useConnectionStore((s) => s.connectedGeneration);
  const hasLoaded = useHostStore((s) => s.hasLoaded);
  const lastSyncGeneration = useHostStore((s) => s.lastSyncGeneration);

  if (status !== 'connected') return false;
  if (!hasLoaded) return false;
  if (connectedGeneration === 0 || lastSyncGeneration === null) return false;
  return lastSyncGeneration >= connectedGeneration;
}

/**
 * Tooltip/title text for disabled admin actions when not ready.
 * Returns undefined when ready (no tooltip).
 */
export function readinessTitle(status: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected', ready: boolean): string | undefined {
  if (ready) return undefined;
  if (status !== 'connected') return 'Unavailable while disconnected';
  // connected but not ready → resync pending
  return 'Re-syncing with server';
}
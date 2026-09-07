import { create } from 'zustand';
import type { ConnectionStatus } from '../lib/socket';

/**
 * Socket connection state shown in every header ("Connected" /
 * "Connection lost — reconnecting…"). `status` flips from the socket service
 * lifecycle; `lastError` carries the last server `error` event for display.
 */
interface ConnectionState {
  status: ConnectionStatus;
  lastError: { code: string; message: string } | null;
  setStatus: (s: ConnectionStatus) => void;
  setLastError: (e: { code: string; message: string } | null) => void;
}

export const useConnectionStore = create<ConnectionState>()((set) => ({
  status: 'idle',
  lastError: null,
  setStatus: (status) => set({ status }),
  setLastError: (lastError) => set({ lastError }),
}));

/** Convenience boolean: still usable (not mid-reconnect) and actually connected. */
export function useIsConnected() {
  return useConnectionStore((s) => s.status === 'connected');
}
import { create } from 'zustand';
import type { ConnectionStatus } from '../lib/socket';

/**
 * Socket connection state shown in every header ("Connected" /
 * "Connection lost — reconnecting…"). `status` flips from the socket service
 * lifecycle; `lastError` carries the last server `error` event for display.
 * `connectedGeneration` increments on every transition TO 'connected' so
 * consumers can distinguish "fresh sync after THIS connection" from "sync from
 * a previous connection that arrived before a reconnect".
 */
interface ConnectionState {
  status: ConnectionStatus;
  lastError: { code: string; message: string } | null;
  connectedGeneration: number;
  setStatus: (s: ConnectionStatus) => void;
  setLastError: (e: { code: string; message: string } | null) => void;
}

export const useConnectionStore = create<ConnectionState>()((set) => ({
  status: 'idle',
  lastError: null,
  connectedGeneration: 0,
  setStatus: (status) => {
    set((cur) => {
      if (status === 'connected' && cur.status !== 'connected') {
        return { status, connectedGeneration: cur.connectedGeneration + 1 };
      }
      return { status };
    });
  },
  setLastError: (lastError) => set({ lastError }),
}));

/** Convenience boolean: still usable (not mid-reconnect) and actually connected. */
export function useIsConnected() {
  return useConnectionStore((s) => s.status === 'connected');
}
import { useEffect } from 'react';
import { connectSocket, disconnectSocket } from '../lib/socket';
import { initRealtime } from '../stores/realtime';

/**
 * Connects the game socket for the current role and tears it down on unmount.
 * The socket service auto-requests an authoritative snapshot on connect, so a
 * page that mounts this hook is always driven by a fresh server state.
 */
export function useGameSocket(role: 'team' | 'host' | 'display', gameCode: string | null, token: string) {
  useEffect(() => {
    if (!gameCode) return;
    initRealtime();
    const sock = connectSocket({ gameCode, token, role, lastSeq: 0 });
    return () => {
      sock?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, gameCode, token]);
}
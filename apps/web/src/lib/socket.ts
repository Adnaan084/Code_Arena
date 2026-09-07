import { io, type Socket } from 'socket.io-client';
import { WS, WS_REQ } from '@wcc/shared';
import type {
  ActivityDto,
  AnnouncementDto,
  DisplayState,
  HostGameState,
  LeaderboardRow,
  PublicDisplayState,
  TeamGameState,
  TeamPresenceDto,
  TimeSyncDto,
} from '@wcc/shared';

/**
 * Socket.IO client for the live event loop.
 *
 * Owns ONE socket per role/game, the connection lifecycle (auth query, rooms,
 * reconnect + authoritative re-sync) and the wire-event fan-out. It is
 * deliberately store-agnostic: stores register handlers via `setHandlers` and
 * decide what to do with each event. The ONLY route back to a clean state is
 * the server's `state:sync` — after ANY reconnect, consumers must replace
 * local state from it (never trust stale Zustand across a disconnect).
 */

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

export interface WireEvent {
  type: string;
  t: number;
  questionCode?: string;
}

export interface SocketHandlers {
  onState: (state: TeamGameState | HostGameState | PublicDisplayState) => void;
  onTime: (t: TimeSyncDto) => void;
  onEvent: (e: WireEvent) => void;
  onPresence: (p: TeamPresenceDto) => void;
  onError: (e: { code: string; message: string }) => void;
  onStatus: (s: ConnectionStatus) => void;
  onLeaderboard: (l: { rows: LeaderboardRow[]; topN: number }) => void;
  onActivity: (a: ActivityDto) => void;
  onAnnouncement: (a: AnnouncementDto) => void;
  onPhase: (p: { state: DisplayState }) => void;
  onReload: (r: { reason: string }) => void;
}

let socket: Socket | null = null;
let handlers: Partial<SocketHandlers> = {};
let resyncTimer: ReturnType<typeof setTimeout> | null = null;
let gameCodeForUrl = '';

const BASE = import.meta.env.VITE_API_URL ?? '';

function emitStatus(s: ConnectionStatus) {
  handlers.onStatus?.(s);
}

export function setSocketHandlers(h: Partial<SocketHandlers>) {
  handlers = { ...handlers, ...h };
}

export function socketStatus(): ConnectionStatus {
  if (!socket) return 'idle';
  if (socket.connected) return 'connected';
  if (socket.active) return 'connecting';
  return 'disconnected';
}

export function isSocketConnected(): boolean {
  return socket?.connected ?? false;
}

export interface ConnectOpts {
  gameCode: string;
  token: string;
  role: 'team' | 'host' | 'display';
  /** Authoritative event seq the client last applied, so the server backfills. */
  lastSeq?: number;
}

export function connectSocket(opts: ConnectOpts) {
  // Same game+role → reuse the live socket (avoids re-auth churn on re-render).
  if (socket && socket.connected && gameCodeForUrl === opts.gameCode) {
    socket.emit(WS_REQ.STATE, { lastSeq: opts.lastSeq ?? 0 });
    return socket;
  }
  if (socket) socket.disconnect();

  gameCodeForUrl = opts.gameCode;
  emitStatus('connecting');

  socket = io(BASE, {
    transports: ['websocket', 'polling'],
    query: {
      gameCode: opts.gameCode.toUpperCase(),
      token: opts.role === 'display' ? '' : opts.token,
      role: opts.role,
      lastSeq: String(opts.lastSeq ?? 0),
    },
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 700,
    reconnectionDelayMax: 6000,
    timeout: 10_000,
  });

  socket.on('connect', () => {
    emitStatus('connected');
    socket?.emit(WS_REQ.STATE, { lastSeq: 0 }); // fresh authoritative state right after join
  });

  socket.on('connect_error', () => {
    emitStatus('reconnecting');
  });

  socket.on('disconnect', () => {
    emitStatus('reconnecting');
  });

  socket.on(WS.STATE_SYNC, (state: TeamGameState | HostGameState | PublicDisplayState) => handlers.onState?.(state));
  socket.on(WS.TIME_SYNC, (t: TimeSyncDto) => handlers.onTime?.(t));
  socket.on('game:event', (e: WireEvent) => handlers.onEvent?.(e));
  socket.on(WS.TEAM_PRESENCE, (p: TeamPresenceDto) => handlers.onPresence?.(p));
  socket.on(WS.LEADERBOARD, (l: { rows: LeaderboardRow[]; topN: number }) => handlers.onLeaderboard?.(l));
  socket.on(WS.ACTIVITY, (a: ActivityDto) => handlers.onActivity?.(a));
  socket.on(WS.ANNOUNCEMENT, (a: AnnouncementDto) => handlers.onAnnouncement?.(a));
  socket.on(WS.GAME_PHASE, (p: { state: DisplayState }) => handlers.onPhase?.(p));
  socket.on(WS.RELOAD, (r: { reason: string }) => handlers.onReload?.(r));
  socket.on('error', (e: { code: string; message: string }) => handlers.onError?.(e));

  return socket;
}

/** Ask the server for a full authoritative state snapshot (used after events). */
export function requestState(lastSeq?: number) {
  socket?.emit(WS_REQ.STATE, { lastSeq: lastSeq ?? 0 });
}

/**
 * Debounced resync: after a `game:event` the wire payload lacks amounts, so we
 * pull full state. Multiple events in a burst collapse into one request.
 */
export function scheduleResync(delayMs = 350) {
  if (resyncTimer) clearTimeout(resyncTimer);
  resyncTimer = setTimeout(() => {
    resyncTimer = null;
    requestState();
  }, delayMs);
}

export function disconnectSocket() {
  if (resyncTimer) {
    clearTimeout(resyncTimer);
    resyncTimer = null;
  }
  socket?.disconnect();
  socket = null;
  emitStatus('idle');
}
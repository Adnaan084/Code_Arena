/**
 * Real-time & domain event contracts.
 *
 * Mutations happen over REST; the socket layer is for broadcast + state
 * recovery. Every persisted domain moment is recorded in the GameEvent table
 * with a monotonically increasing `seq`; the same event is pushed live over
 * the socket so the activity feed and any reconnecting client stay coherent.
 */
import type {
  ActivityDto,
  AnnouncementDto,
  DisplayState,
  HostGameState,
  LeaderboardRow,
  PhaseRules,
  PublicDisplayState,
  TeamGameState,
} from './types';

/** Persisted domain event vocabulary (GameEvent.type, activity feed, audit). */
export const GAME_EVENTS = [
  'GAME_STARTED',
  'GAME_PAUSED',
  'GAME_RESUMED',
  'MARKET_OPENED',
  'MARKET_CLOSED',
  'FINAL_MINUTE',
  'FINAL_SCORING',
  'GAME_COMPLETED',
  'TEAM_JOINED',
  'TEAM_DISQUALIFIED',
  'TEAM_CONNECTED',
  'TEAM_DISCONNECTED',
  'QUESTION_ADDED',
  'QUESTION_ENABLED',
  'QUESTION_DISABLED',
  'QUESTION_PURCHASED',
  'QUESTION_SOLVED',
  'QUESTION_FAILED',
  'TRADE_CREATED',
  'TRADE_ACCEPTED',
  'TRADE_REJECTED',
  'TRADE_CANCELLED',
  'TRADE_EXPIRED',
  'ANNOUNCEMENT_CREATED',
] as const;
export type GameEventType = (typeof GAME_EVENTS)[number];

/** Server→client socket message names. */
export const WS = {
  STATE_SYNC: 'state:sync',
  TIME_SYNC: 'time:sync',
  LEADERBOARD: 'leaderboard',
  ACTIVITY: 'activity',
  ANNOUNCEMENT: 'announcement',
  GAME_PHASE: 'game:phase',
  TEAM_PRESENCE: 'team:presence',
  RELOAD: 'reload',
} as const;
export type WsName = (typeof WS)[keyof typeof WS];

/** Client→server socket request names. */
export const WS_REQ = {
  STATE: 'req:state',
  BACKFILL: 'req:backfill',
} as const;

/** Every message carries server time so stale UIs never mislead. */
export interface Envelope {
  /** Server epoch ms when produced. */
  t: number;
}

export interface TimeSyncDto {
  remainingMs: number;
  totalMs: number;
  state: DisplayState;
  phase: PhaseRules;
}

export interface TeamPresenceDto {
  teamId: string;
  name: string;
  online: boolean;
  /** How many team sockets are currently connected (0..playersPerTeam). */
  connectedCount: number;
  disconnectedAt: string | null;
}

/** Map of ws event name → payload type. */
export interface WsPayloadMap {
  [WS.STATE_SYNC]: TeamGameState | HostGameState | PublicDisplayState;
  [WS.TIME_SYNC]: TimeSyncDto;
  [WS.LEADERBOARD]: { rows: LeaderboardRow[]; topN: number };
  [WS.ACTIVITY]: ActivityDto;
  [WS.ANNOUNCEMENT]: AnnouncementDto;
  [WS.GAME_PHASE]: { state: DisplayState };
  [WS.TEAM_PRESENCE]: TeamPresenceDto;
  [WS.RELOAD]: { reason: string };
}

export type WsPayload<K extends WsName> = WsPayloadMap[K];

export interface WsMessage<K extends WsName = WsName> extends Envelope {
  name: K;
  payload: WsPayload<K>;
  /** Current game event seq (null for transient messages like TIME_SYNC). */
  seq: number | null;
}

export { WS_REQ as WS_REQ_CONST };
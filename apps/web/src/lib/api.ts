import type {
  ActivityDto,
  AnnouncementDto,
  AnswerSubmission,
  GameMeta,
  HostGameState,
  InventoryItem,
  LeaderboardRow,
  MarketItem,
  PublicDisplayState,
  QuestionAdmin,
  TeamGameState,
  TeamSummary,
  TradeDto,
  TransactionDto,
} from '@wcc/shared';

/**
 * Typed API client. Base URL resolves to `VITE_API_URL` when set (separately
 * hosted API) or same-origin (the Vite /api proxy → :4000 in dev). Auth is a
 * Bearer token chosen per call; every error is normalized to `ApiError`
 * carrying the backend's `{ error: { code, message, details } }` envelope.
 */
const API_BASE: string = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiErrorEnvelope {
  error: { code: string; message: string; details?: unknown };
}

interface RequestOpts {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  token?: string | null;
  body?: unknown;
}

async function request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;

  let body: string | undefined;
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { method: opts.method ?? 'GET', headers, body });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server.');
  }

  const text = await res.text();
  const data: unknown = text ? safeParse(text) : undefined;

  if (!res.ok) {
    const envelope = isEnvelope(data) ? data : undefined;
    if (envelope) throw new ApiError(res.status, envelope.error.code, envelope.error.message, envelope.error.details);
    throw new ApiError(res.status, 'HTTP_ERROR', `Request failed (${res.status}).`);
  }
  return data as T;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isEnvelope(d: unknown): d is ApiErrorEnvelope {
  return typeof d === 'object' && d !== null && 'error' in d;
}

/** Cryptographically-random, backend-valid idempotency key (8–64 chars). */
export function newIdempotencyKey(): string {
  return (crypto.randomUUID?.() ?? `wcc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`).slice(0, 64);
}

// ─── Public (no auth) ───────────────────────────────────────────────────
export interface CreateGameResult {
  gameCode: string;
  hostToken: string;
}
export interface PublicGameInfo {
  code: string;
  title: string;
  state: string;
}
export interface JoinGameResult {
  teamId: string;
  teamName: string;
  teamAccessToken: string;
}

export const api = {
  health: () => request<{ ok: boolean; time: string; gameReady: boolean }>('/api/health'),

  createGame: (title: string, config?: Record<string, unknown>) =>
    request<CreateGameResult>('/api/public/games', { method: 'POST', body: { title, config } }),

  getPublicGame: (code: string) => request<PublicGameInfo>(`/api/public/games/${encodeURIComponent(code)}`),

  joinGame: (code: string, teamName: string, player1: string, player2?: string) =>
    request<JoinGameResult>(`/api/public/games/${encodeURIComponent(code)}/teams/join`, {
      method: 'POST',
      body: { teamName, player1, player2 },
    }),

  joinExisting: (code: string, teamAccessToken: string) =>
    request<JoinGameResult>(`/api/public/games/${encodeURIComponent(code)}/teams/join-existing`, {
      method: 'POST',
      body: { teamAccessToken },
    }),

  // ─── Team ─────────────────────────────────────────────────────────────
  teamState: (token: string) => request<TeamGameState>('/api/team/state', { token }),
  teamMarketplace: (token: string) => request<MarketItem[]>('/api/team/marketplace', { token }),
  teamInventory: (token: string) => request<InventoryItem[]>('/api/team/inventory', { token }),
  teamLeaderboard: (token: string) => request<LeaderboardRow[]>('/api/team/leaderboard', { token }),
  teamTransactions: (token: string) => request<TransactionDto[]>('/api/team/transactions', { token }),

  purchaseQuestion: (token: string, questionId: string, idempotencyKey: string) =>
    request<{
      ok: boolean;
      already: boolean;
      questionId: string;
      questionCode: string;
      balanceAfter: number | null;
      events: unknown[];
    }>(`/api/team/questions/${encodeURIComponent(questionId)}/purchase`, {
      method: 'POST',
      token,
      body: { idempotencyKey },
    }),

  submitAnswer: (token: string, questionId: string, answer: AnswerSubmission, idempotencyKey: string) =>
    request<{
      correct: boolean;
      already: boolean;
      coinsAwarded: number;
      balanceAfter: number | null;
      events: unknown[];
    }>(`/api/team/questions/${encodeURIComponent(questionId)}/submit`, {
      method: 'POST',
      token,
      body: { idempotencyKey, answer },
    }),

  teamTrades: (token: string) => request<TradeDto[]>('/api/team/trades', { token }),

  createTrade: (
    token: string,
    input: { targetTeamId: string; offeredQuestionId: string; requestedQuestionId: string; coins: number },
    idempotencyKey: string,
  ) =>
    request<{ tradeId: string; already: boolean } & { events: unknown[] }>('/api/team/trades', {
      method: 'POST',
      token,
      body: { ...input, idempotencyKey },
    }),

  resolveTrade: (token: string, tradeId: string, action: 'accept' | 'reject' | 'cancel', idempotencyKey: string) =>
    request<Record<string, unknown> & { events: unknown[] }>(`/api/team/trades/${encodeURIComponent(tradeId)}/${action}`, {
      method: 'POST',
      token,
      body: { idempotencyKey },
    }),

  // ─── Host ─────────────────────────────────────────────────────────────
  hostState: (token: string) => request<HostGameState>('/api/host/state', { token }),
  hostTeams: (token: string) => request<TeamSummary[]>('/api/host/teams', { token }),
  hostQuestions: (token: string) => request<QuestionAdmin[]>('/api/host/questions', { token }),

  hostAction: (token: string, action: string) =>
    request<Record<string, unknown>>(`/api/host/${action}`, { method: 'POST', token, body: {} }),

  hostCreateQuestion: (token: string, body: unknown) => request<QuestionAdmin>('/api/host/questions', { method: 'POST', token, body }),
  hostUpdateQuestion: (token: string, id: string, body: unknown) =>
    request<QuestionAdmin>(`/api/host/questions/${encodeURIComponent(id)}`, { method: 'PATCH', token, body }),
  hostToggleQuestion: (token: string, id: string, enabled: boolean) =>
    request<QuestionAdmin>(`/api/host/questions/${encodeURIComponent(id)}/enabled`, { method: 'PATCH', token, body: { enabled } }),
  hostDeleteQuestion: (token: string, id: string) => request<unknown>(`/api/host/questions/${encodeURIComponent(id)}`, { method: 'DELETE', token }),

  hostAdjustCoins: (token: string, teamId: string, amount: number, reason: string) =>
    request<unknown>('/api/host/coins/adjust', { method: 'POST', token, body: { teamId, amount, reason } }),

  hostRefund: (token: string, teamId: string, questionId: string, reason: string) =>
    request<unknown>('/api/host/purchases/refund', { method: 'POST', token, body: { teamId, questionId, reason } }),

  hostCancelTrade: (token: string, tradeId: string, reason: string) =>
    request<unknown>(`/api/host/trades/${encodeURIComponent(tradeId)}/cancel`, { method: 'POST', token, body: { reason } }),

  hostAnnouncement: (token: string, message: string) =>
    request<AnnouncementDto>('/api/host/announcements', { method: 'POST', token, body: { message } }),

  hostDisqualify: (token: string, teamId: string, reason?: string) =>
    request<TeamSummary>(`/api/host/teams/${encodeURIComponent(teamId)}/disqualify`, { method: 'POST', token, body: { reason } }),
  hostReinstate: (token: string, teamId: string) =>
    request<TeamSummary>(`/api/host/teams/${encodeURIComponent(teamId)}/reinstate`, { method: 'POST', token, body: {} }),

  hostAudit: (token: string) => request<unknown[]>('/api/host/audit', { token }),
  hostTransactions: (token: string) => request<TransactionDto[]>('/api/host/transactions', { token }),
  hostActivity: (token: string, sinceSeq?: number) =>
    request<ActivityDto[]>(`/api/host/activity${sinceSeq ? `?sinceSeq=${sinceSeq}` : ''}`, { token }),

  // ─── Display (public) ─────────────────────────────────────────────────
  displayState: (code: string) => request<PublicDisplayState>(`/api/display/${encodeURIComponent(code)}`),
  displayEvents: (code: string, sinceSeq: number) =>
    request<{ events: ActivityDto[]; seq: number }>(`/api/display/${encodeURIComponent(code)}/events?sinceSeq=${sinceSeq}`),

  // Convenience: read a typed GameMeta from a state payload.
  metaOf(g: TeamGameState | HostGameState | PublicDisplayState): GameMeta {
    return g.meta;
  },
};
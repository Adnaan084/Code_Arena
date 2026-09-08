import { create } from 'zustand';
import type { ActivityDto, HostGameState, HostPurchase, LeaderboardRow, QuestionAdmin, TeamPresenceDto, TeamSummary, TradeDto, TransactionDto } from '@wcc/shared';
import type { GameMeta, AuditLogEntry } from '@wcc/shared';

/**
 * Host dashboard state — an administrative mirror of the game. Presence is
 * keyed by teamId so the host lobby can show "2/2 connected" per team; teams
 * that never joined or sent presence read `online` from their summary instead.
 */
interface HostState {
  meta: GameMeta | null;
  teams: TeamSummary[];
  questions: QuestionAdmin[];
  activity: ActivityDto[];
  transactions: TransactionDto[];
  leaderboard: LeaderboardRow[];
  audit: AuditLogEntry[];
  purchases: HostPurchase[];
  /** All trades in the game (active + history) — the host trade-admin surface. */
  trades: TradeDto[];
  lastEventSeq: number;
  /** teamId → live connected-seat count (from team:presence). */
  presence: Record<string, TeamPresenceDto>;
  connectedCount: (teamId: string) => number | null;

  applyState: (s: HostGameState) => void;
  applyPresence: (p: TeamPresenceDto) => void;
  reset: () => void;
}

const initial = {
  meta: null,
  teams: [],
  questions: [],
  activity: [],
  transactions: [],
  leaderboard: [],
  audit: [],
  purchases: [],
  trades: [],
  lastEventSeq: 0,
  presence: {},
};

export const useHostStore = create<HostState>()((set, get) => ({
  ...initial,

  applyState: (s) =>
    set({
      meta: s.meta,
      teams: s.teams,
      questions: s.questions,
      activity: s.activity,
      transactions: s.transactions,
      leaderboard: s.leaderboard,
      audit: s.audit,
      // The snapshot is wholesale-replaced; a payload that omits a field must
      // degrade to the empty value rather than clobbering the store to undefined
      // (purchases is the one H2-B field the host wire shape historically lacked;
      // trades is the H2-C field, guarded the same way for the same reason).
      purchases: s.purchases ?? [],
      trades: s.trades ?? [],
      lastEventSeq: s.lastEventSeq,
    }),

  applyPresence: (p) => set((cur) => ({ presence: { ...cur.presence, [p.teamId]: p } })),

  connectedCount: (teamId) => {
    const p = get().presence[teamId];
    return p ? p.connectedCount : null;
  },

  reset: () => set({ ...initial }),
}));
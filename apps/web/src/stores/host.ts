import { create } from 'zustand';
import type { ActivityDto, HostGameState, LeaderboardRow, QuestionAdmin, TeamPresenceDto, TeamSummary, TransactionDto } from '@wcc/shared';
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
      lastEventSeq: s.lastEventSeq,
    }),

  applyPresence: (p) => set((cur) => ({ presence: { ...cur.presence, [p.teamId]: p } })),

  connectedCount: (teamId) => {
    const p = get().presence[teamId];
    return p ? p.connectedCount : null;
  },

  reset: () => set({ ...initial }),
}));
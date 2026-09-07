import { create } from 'zustand';
import type { ActivityDto, LeaderboardRow, PublicDisplayState } from '@wcc/shared';
import type { GameMeta } from '@wcc/shared';

/**
 * Public/projector display state. It only ever holds what a viewer may see:
 * meta, the leaderboard and recent public events — never team wallets or
 * question internals. The projector re-syncs via `state:sync` (socket) and the
 * loop just works because the server emits the same authoritative events here
 * as it does to players.
 */
interface DisplayStateStore {
  meta: GameMeta | null;
  leaderboard: LeaderboardRow[];
  recentActivity: ActivityDto[];
  lastEventSeq: number;

  applyState: (s: PublicDisplayState) => void;
  reset: () => void;
}

export const useDisplayStore = create<DisplayStateStore>()((set) => ({
  meta: null,
  leaderboard: [],
  recentActivity: [],
  lastEventSeq: 0,

  applyState: (s) =>
    set({
      meta: s.meta,
      leaderboard: s.leaderboard,
      recentActivity: s.recentActivity,
      lastEventSeq: s.lastEventSeq,
    }),

  reset: () => set({ meta: null, leaderboard: [], recentActivity: [], lastEventSeq: 0 }),
}));
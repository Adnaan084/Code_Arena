import { create } from 'zustand';
import type {
  ActivityDto,
  InventoryItem,
  LeaderboardRow,
  MarketItem,
  TeamGameState,
  TeamPresenceDto,
  TeamSummary,
  TradeDto,
  TransactionDto,
} from '@wcc/shared';
import type { GameMeta } from '@wcc/shared';

/**
 * Team client global state. The SERVER is the only source of truth for
 * coins/score/inventory/trades — wire `game:event` payloads deliberately carry
 * no amounts, so after any event we resync (`req:state`) and REPLACE state here
 * from the authoritative `state:sync`. Never compute a balance client-side.
 */
interface TeamState {
  meta: GameMeta | null;
  team: TeamSummary | null;
  marketplace: MarketItem[];
  inventory: InventoryItem[];
  trades: TradeDto[];
  transactions: TransactionDto[];
  leaderboard: LeaderboardRow[];
  activity: ActivityDto[];
  lastEventSeq: number;
  /** Own-team live presence (connected seat count) for the lobby. */
  presence: TeamPresenceDto | null;

  applyState: (s: TeamGameState) => void;
  applyPresence: (p: TeamPresenceDto) => void;
  reset: () => void;
}

const initial = {
  meta: null,
  team: null,
  marketplace: [],
  inventory: [],
  trades: [],
  transactions: [],
  leaderboard: [],
  activity: [],
  lastEventSeq: 0,
  presence: null,
};

export const useTeamStore = create<TeamState>()((set) => ({
  ...initial,

  applyState: (s) =>
    set({
      meta: s.meta,
      team: s.team,
      marketplace: s.marketplace,
      inventory: s.inventory,
      trades: s.trades,
      transactions: s.transactions,
      leaderboard: s.leaderboard,
      activity: s.activity,
      lastEventSeq: s.lastEventSeq,
    }),

  applyPresence: (p) => set({ presence: p }),

  reset: () => set({ ...initial }),
}));

/** The wallet/coin balance a team screen should display. Null before auth/state. */
export function useTeamCoins(): number | null {
  return useTeamStore((s) => s.team?.coins ?? null);
}
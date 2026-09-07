import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Current session for THIS device. A team's two players share one access
 * token; whichever device joins first carries the team token and the other
 * re-attaches with it (`join-existing`). Tokens persist across refreshes.
 */
export type Role = 'team' | 'host';

interface AuthState {
  role: Role | null;
  gameCode: string | null;
  /** Shared team access token (Bearer). */
  teamToken: string | null;
  hostToken: string | null;
  teamId: string | null;
  teamName: string | null;
  /** This device's player/seat; null when unknown (e.g. second player has none yet). */
  playerName: string | null;

  setTeamSession: (s: {
    gameCode: string;
    teamToken: string;
    teamId: string;
    teamName: string;
    playerName?: string | null;
  }) => void;
  setHostSession: (s: { gameCode: string; hostToken: string }) => void;
  patch: (p: Partial<{ teamId: string; teamName: string; playerName: string | null }>) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      role: null,
      gameCode: null,
      teamToken: null,
      hostToken: null,
      teamId: null,
      teamName: null,
      playerName: null,

      setTeamSession: (s) =>
        set({
          role: 'team',
          gameCode: s.gameCode,
          teamToken: s.teamToken,
          hostToken: null,
          teamId: s.teamId,
          teamName: s.teamName,
          playerName: s.playerName ?? null,
        }),
      setHostSession: (s) =>
        set({
          role: 'host',
          gameCode: s.gameCode,
          teamToken: null,
          hostToken: s.hostToken,
          teamId: null,
          teamName: null,
          playerName: null,
        }),
      patch: (p) => set(p),
      clear: () =>
        set({
          role: null,
          gameCode: null,
          teamToken: null,
          hostToken: null,
          teamId: null,
          teamName: null,
          playerName: null,
        }),
    }),
    {
      name: 'wic:auth:v1',
      partialize: (s) => ({
        role: s.role,
        gameCode: s.gameCode,
        teamToken: s.teamToken,
        hostToken: s.hostToken,
        teamId: s.teamId,
        teamName: s.teamName,
        playerName: s.playerName,
      }),
    },
  ),
);
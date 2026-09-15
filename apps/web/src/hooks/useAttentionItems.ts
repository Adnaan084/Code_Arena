/**
 * H3 — Attention items derived from authoritative host state.
 *
 * Deterministic, pure, no side effects. Returns a stable list of attention
 * conditions the host may need to act on. Order is:
 *   1. Partially connected teams (fewer connected seats than playersPerTeam)
 *   2. Disqualified teams
 *   3. OPEN trades
 *
 * Within each category items are ordered by team joinOrder / trade createdAt
 * for stable rendering.
 */
import { useMemo } from 'react';
import { useHostStore } from '../stores/host';
import type { TeamPresenceDto, TeamSummary, TradeDto, GameMeta } from '@wcc/shared';

export type AttentionReason = 'PARTIAL_CONNECTION' | 'DISQUALIFIED' | 'OPEN_TRADE';

export interface AttentionItem {
  id: string;
  reason: AttentionReason;
  teamName?: string;
  teamId?: string;
  /** Human-readable one-liner for the host. */
  detail: string;
  /** Optional navigation target / related info. */
  meta?: string;
}

function partiallyConnected(
  teams: TeamSummary[],
  presence: Record<string, TeamPresenceDto>,
  playersPerTeam: number,
): AttentionItem[] {
  return teams
    .filter((t) => {
      if (t.status !== 'ACTIVE') return false;
      const p = presence[t.id];
      const connected = p ? p.connectedCount : t.online ? 1 : 0;
      return connected < playersPerTeam && connected > 0;
    })
    .sort((a, b) => a.joinOrder - b.joinOrder)
    .map((t) => {
      const p = presence[t.id];
      const connected = p ? p.connectedCount : t.online ? 1 : 0;
      return {
        id: `partial-${t.id}`,
        reason: 'PARTIAL_CONNECTION' as const,
        teamName: t.name,
        teamId: t.id,
        detail: `${connected}/${playersPerTeam} players connected`,
      };
    });
}

function disqualifiedTeams(teams: TeamSummary[]): AttentionItem[] {
  return teams
    .filter((t) => t.status === 'DISQUALIFIED')
    .sort((a, b) => a.joinOrder - b.joinOrder)
    .map((t) => ({
      id: `disq-${t.id}`,
      reason: 'DISQUALIFIED' as const,
      teamName: t.name,
      teamId: t.id,
      detail: 'DISQUALIFIED',
    }));
}

function openTrades(trades: TradeDto[]): AttentionItem[] {
  return trades
    .filter((t) => t.state === 'OPEN')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((t) => ({
      id: `trade-${t.id}`,
      reason: 'OPEN_TRADE' as const,
      teamName: `${t.fromTeam.name} → ${t.toTeam.name}`,
      detail: `OPEN trade`,
      meta: t.id,
    }));
}

export function useAttentionItems(): AttentionItem[] {
  const teams = useHostStore((s) => s.teams);
  const presence = useHostStore((s) => s.presence);
  const trades = useHostStore((s) => s.trades);
  const meta = useHostStore((s) => s.meta);

  const playersPerTeam = meta?.playersPerTeam ?? 2;

  return useMemo(() => [
    ...partiallyConnected(teams, presence, playersPerTeam),
    ...disqualifiedTeams(teams),
    ...openTrades(trades),
  ], [teams, presence, trades, playersPerTeam]);
}

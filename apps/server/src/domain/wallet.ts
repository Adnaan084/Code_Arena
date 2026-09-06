/**
 * Coin math: every balance change is a single atomic SQL UPDATE guarded by a
 * CHECK (coins >= required) and paired with an immutable ledger row. A user
 * can never drive a balance negative, and every change is auditable.
 */
import { Prisma } from '@prisma/client';
import type { GameConfig, RuleConfig, TransactionType } from '@wcc/shared';
import { computeScore } from '@wcc/shared';
import type { Tx } from '../lib/prisma';
import { AppError } from '../lib/errors';

export function gameRules(cfg: GameConfig): RuleConfig {
  return {
    gameDurationMinutes: cfg.gameDurationMinutes,
    tradeWindowMinutes: cfg.tradeWindowMinutes,
    allowSubmitAfterClose: cfg.allowSubmitAfterClose,
  };
}

export interface CoinChange {
  gameId: string;
  teamId: string;
  delta: number; // signed
  type: TransactionType;
  questionCode?: string | null;
  tradeId?: string | null;
  reason?: string | null;
}

/**
 * Atomically adjust a team wallet and write the immutable ledger row.
 * Returns the exact post-change balance (from RETURNING) — correct even when
 * several operations for the same team run concurrently.
 */
export async function changeCoins(tx: Tx, change: CoinChange): Promise<number> {
  const { teamId, delta } = change;
  let rows: { coins: number }[];
  if (delta >= 0) {
    rows = await tx.$queryRaw<{ coins: number }[]>(
      Prisma.sql`UPDATE "Team" SET "coins" = "coins" + ${delta} WHERE "id" = ${teamId} RETURNING "coins"`,
    );
  } else {
    const need = -delta;
    rows = await tx.$queryRaw<{ coins: number }[]>(
      Prisma.sql`UPDATE "Team" SET "coins" = "coins" - ${need} WHERE "id" = ${teamId} AND "coins" >= ${need} RETURNING "coins"`,
    );
    if (rows.length !== 1) {
      throw new AppError(409, 'INSUFFICIENT_FUNDS', 'Your team does not have enough coins.');
    }
  }
  if (rows.length !== 1) throw new AppError(409, 'TEAM_NOT_FOUND', 'Team not found.');
  const balanceAfter = Number(rows[0]!.coins);

  await tx.transaction.create({
    data: {
      gameId: change.gameId,
      teamId,
      type: change.type,
      amount: delta,
      balanceAfter,
      questionCode: change.questionCode ?? null,
      tradeId: change.tradeId ?? null,
      reason: change.reason ?? null,
    },
  });
  return balanceAfter;
}

/** Recompute and persist a team's live score from the configured formula. */
export async function refreshScore(db: Tx, config: GameConfig, teamId: string): Promise<void> {
  const team = await db.team.findUnique({
    where: { id: teamId },
    select: { coins: true, rewardsEarned: true, solvedCount: true, failedCount: true, score: true },
  });
  if (!team) return;
  const next = computeScore(config, {
    coins: team.coins,
    rewardsEarned: team.rewardsEarned,
    solvedCount: team.solvedCount,
    failedCount: team.failedCount,
  });
  if (next !== team.score) {
    await db.team.update({ where: { id: teamId }, data: { score: next } });
  }
}
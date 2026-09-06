/**
 * Marketplace read + the atomic purchase.
 *
 * Purchase correctness model (the race the whole game leans on): the question
 * row is claimed first via a guarded UPDATE ... WHERE status='AVAILABLE' —
 * exactly ONE concurrent purchase can win that claim because Postgres takes a
 * row lock and re-evaluates the predicate after the winner commits. The wallet
 * debit is a second atomic, guarded UPDATE, so a team can never go negative.
 * Both (plus ownership, purchase row, ledger row, event) commit in one
 * transaction — any failure rolls everything back.
 */
import type { Game, Question } from '@prisma/client';
import {
  type Difficulty,
  type GameConfig,
  type MarketItem,
  DIFFICULTY_WEIGHT,
  phaseRules,
} from '@wcc/shared';
import type { DB } from '../lib/prisma';
import { AppError, conflict, isPrismaUniqueViolation, notFound } from '../lib/errors';
import { gameRules, changeCoins, refreshScore } from './wallet';
import { createEvent } from './feed';
import { toMarketItem, type TradeWithRelations } from './serializers';

export type MarketplaceSort = 'price-asc' | 'reward-desc' | 'ratio-desc' | 'difficulty';

export async function listMarketplace(
  db: DB,
  game: Game,
  teamId: string,
  opts: { difficulty?: Difficulty; category?: string; sort?: MarketplaceSort },
): Promise<MarketItem[]> {
  const where = {
    gameId: game.id,
    enabled: true,
    status: 'AVAILABLE' as const,
    ...(opts.difficulty ? { difficulty: opts.difficulty } : {}),
    ...(opts.category ? { category: opts.category } : {}),
  };
  const questions = await db.question.findMany({ where, include: { ownership: { select: { teamId: true } } } });
  const items = questions.map((q) => toMarketItem(q, teamId));

  switch (opts.sort ?? 'ratio-desc') {
    case 'price-asc':
      return items.sort((a, b) => a.price - b.price);
    case 'reward-desc':
      return items.sort((a, b) => b.reward - a.reward);
    case 'ratio-desc':
      return items.sort((a, b) => (b.reward / (b.price || 1)) - (a.reward / (a.price || 1)) || a.price - b.price);
    case 'difficulty':
      return items.sort(
        (a, b) => DIFFICULTY_WEIGHT[a.difficulty] - DIFFICULTY_WEIGHT[b.difficulty] || a.price - b.price,
      );
  }
}

export interface PurchaseResult {
  ok: boolean;
  already: boolean;
  questionId: string;
  questionCode: string;
  balanceAfter: number | null;
  events: Awaited<ReturnType<typeof createEvent>>[];
}

export async function purchaseQuestion(
  db: DB,
  game: Game,
  teamId: string,
  questionId: string,
  idempotencyKey?: string,
): Promise<PurchaseResult> {
  const config = game.config as GameConfig;
  const rules = phaseRules(
    { state: game.state, pausedAt: game.pausedAt, startTime: game.startTime, endTime: game.endTime, phaseStartedAt: game.startTime },
    gameRules(config),
    new Date(),
  );
  if (!rules.canBuy) {
    throw new AppError(409, 'MARKET_CLOSED', 'The market is closed for purchases right now.');
  }

  // Fast path: if the idempotency key exists, the purchase already succeeded.
  if (idempotencyKey) {
    const prior = await db.purchase.findUnique({
      where: { teamId_idempotencyKey: { teamId, idempotencyKey } },
    });
    if (prior) return { ok: true, already: true, questionId, questionCode: prior.questionId, balanceAfter: null, events: [] };
  }

  try {
    return await db.$transaction(
      async (tx) => {
        const team = await tx.team.findUnique({ where: { id: teamId }, select: { id: true, name: true, status: true } });
        if (!team) throw notFound('Team not found.');
        if (team.status !== 'ACTIVE') throw new AppError(403, 'TEAM_DISQUALIFIED', 'Your team has been disqualified.');

        const claimed = await tx.question.updateMany({
          where: { id: questionId, gameId: game.id, status: 'AVAILABLE', enabled: true },
          data: { status: 'SOLD' },
        });
        if (claimed.count !== 1) {
          throw conflict('This question was just purchased by another team.');
        }
        const question = await tx.question.findUniqueOrThrow({ where: { id: questionId } });
        const balanceAfter = await changeCoins(tx, {
          gameId: game.id,
          teamId,
          delta: -question.price,
          type: 'PURCHASE',
          questionCode: question.code,
          reason: `Purchased ${question.code}`,
        });
        await tx.questionOwnership.create({
          data: {
            gameId: game.id,
            teamId,
            questionId: question.id,
            purchasePrice: question.price,
            reward: question.reward,
          },
        });
        await tx.purchase.create({
          data: { gameId: game.id, teamId, questionId: question.id, pricePaid: question.price, reward: question.reward, idempotencyKey: idempotencyKey ?? null },
        });
        await tx.team.update({ where: { id: teamId }, data: { purchasedCount: { increment: 1 } } });
        await refreshScore(tx, config, teamId);
        const ev = await createEvent(tx, game, 'QUESTION_PURCHASED', {
          teamId,
          teamName: team.name,
          questionCode: question.code,
          amount: question.price,
          payload: { questionId: question.id, price: question.price },
        });
        return { ok: true, already: false, questionId, questionCode: question.code, balanceAfter, events: [ev] };
      },
      { timeout: 8_000 },
    );
  } catch (e) {
    // A duplicate same-key request raced us and won; the unique constraint on
    // (teamId, idempotencyKey) fired. The purchase exists → idempotent success.
    if (idempotencyKey && isPrismaUniqueViolation(e)) {
      const prior = await db.purchase.findUnique({
        where: { teamId_idempotencyKey: { teamId, idempotencyKey } },
      });
      if (prior) return { ok: true, already: true, questionId, questionCode: prior.questionId, balanceAfter: null, events: [] };
    }
    throw e;
  }
}

/** Sanitized question payloads for the team's inventory (ownership + question). */
export async function listOwnedQuestions(db: DB, game: Game, teamId: string, maxAttempts: number) {
  const ownerships = await db.questionOwnership.findMany({
    where: { gameId: game.id, teamId },
    include: { question: true },
    orderBy: { purchasedAt: 'desc' },
  });
  return ownerships.map((o) => ({
    ownershipId: o.id,
    question: o.question,
    status: o.status,
    attemptsUsed: o.attemptsUsed,
    maxAttempts,
    purchasedAt: o.purchasedAt,
  }));
}

/** Type helper for trade DTO building below. */
export type { Question, TradeWithRelations };
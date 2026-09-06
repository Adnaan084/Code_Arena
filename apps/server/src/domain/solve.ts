/**
 * Answer submission & grading.
 *
 * Grading is offline and predefined (question.answerData) — the server never
 * executes participant code. The whole attempt (grade → wallet credit →
 * ownership status → ledger → event) is one transaction, so a reward can never
 * be awarded twice and an answer can never be re-submitted as a fresh attempt
 * past the configured limit (idempotency keys + attemptsUsed guard).
 */
import type { Game } from '@prisma/client';
import { type AnswerData, type AnswerSubmission, type GameConfig, gradeAnswer, phaseRules } from '@wcc/shared';
import type { DB } from '../lib/prisma';
import { AppError, conflict, isPrismaUniqueViolation, notFound } from '../lib/errors';
import { gameRules, changeCoins, refreshScore } from './wallet';
import { createEvent } from './feed';

export interface SolveResult {
  correct: boolean;
  already: boolean;
  coinsAwarded: number;
  balanceAfter: number | null;
  events: Awaited<ReturnType<typeof createEvent>>[];
}

export async function submitAnswer(
  db: DB,
  game: Game,
  teamId: string,
  questionId: string,
  submission: AnswerSubmission,
  idempotencyKey?: string,
): Promise<SolveResult> {
  const config = game.config as GameConfig;
  const rules = phaseRules(
    { state: game.state, pausedAt: game.pausedAt, startTime: game.startTime, endTime: game.endTime, phaseStartedAt: game.startTime },
    gameRules(config),
    new Date(),
  );
  if (!rules.canSubmit) {
    throw new AppError(409, 'SUBMIT_CLOSED', 'Submissions are closed right now.');
  }

  // Fast path: if the idempotency key exists, the submission already succeeded.
  if (idempotencyKey) {
    const prior = await db.submission.findUnique({
      where: { teamId_idempotencyKey: { teamId, idempotencyKey } },
    });
    if (prior) {
      return {
        correct: prior.isCorrect,
        already: true,
        coinsAwarded: prior.coinsAwarded,
        balanceAfter: null,
        events: [],
      };
    }
  }

  try {
    return await db.$transaction(
      async (tx) => {
        const team = await tx.team.findUnique({ where: { id: teamId }, select: { id: true, name: true, status: true } });
        if (!team) throw notFound('Team not found.');
        if (team.status !== 'ACTIVE') throw new AppError(403, 'TEAM_DISQUALIFIED', 'Your team has been disqualified.');

        const ownership = await tx.questionOwnership.findUnique({
          where: { questionId },
          include: { question: true },
        });
        if (!ownership || ownership.teamId !== teamId) {
          throw notFound('Your team does not own this question.');
        }
        if (ownership.status === 'SOLVED') throw conflict('This question has already been solved.');
        if (ownership.tradeLock) throw conflict('This question is locked by a pending trade offer.');

        if (ownership.attemptsUsed >= config.maxAttempts) {
          throw conflict(`No attempts remaining for this question (max ${config.maxAttempts}).`);
        }

        const answerData = ownership.question.answerData as unknown as AnswerData;
        const correct = gradeAnswer(answerData, submission);
        const attemptNumber = ownership.attemptsUsed + 1;
        let coinsAwarded = 0;
        let balanceAfter: number | null = null;

        const ownershipUpdate: Parameters<typeof tx.questionOwnership.update>[0]['data'] = { attemptsUsed: attemptNumber };
        if (correct) {
          balanceAfter = await changeCoins(tx, {
            gameId: game.id,
            teamId,
            delta: ownership.reward,
            type: 'REWARD',
            questionCode: ownership.question.code,
            reason: `Solved ${ownership.question.code}`,
          });
          coinsAwarded = ownership.reward;
          ownershipUpdate.status = 'SOLVED';
        } else if (config.failMarksSolved) {
          ownershipUpdate.status = 'FAILED';
        }

        await tx.questionOwnership.update({ where: { id: ownership.id }, data: ownershipUpdate });
        await tx.team.update({
          where: { id: teamId },
          data: correct
            ? { solvedCount: { increment: 1 }, rewardsEarned: { increment: ownership.reward } }
            : { failedCount: { increment: 1 } },
        });
        await refreshScore(tx, config, teamId);
        await tx.submission.create({
          data: {
            gameId: game.id,
            teamId,
            questionId,
            ownershipId: ownership.id,
            attemptNumber,
            answer: (submission as unknown as object),
            isCorrect: correct,
            coinsAwarded,
            idempotencyKey: idempotencyKey ?? null,
          },
        });
        const ev = await createEvent(tx, game, correct ? 'QUESTION_SOLVED' : 'QUESTION_FAILED', {
          teamId,
          teamName: team.name,
          questionCode: ownership.question.code,
          amount: correct ? ownership.reward : 0,
          payload: { questionId, correct, reward: correct ? ownership.reward : 0 },
        });
        return { correct, already: false, coinsAwarded, balanceAfter, events: [ev] };
      },
      { timeout: 8_000 },
    );
  } catch (e) {
    if (idempotencyKey && isPrismaUniqueViolation(e)) {
      const prior = await db.submission.findUnique({
        where: { teamId_idempotencyKey: { teamId, idempotencyKey } },
      });
      if (prior) {
        return { correct: prior.isCorrect, already: true, coinsAwarded: prior.coinsAwarded, balanceAfter: null, events: [] };
      }
    }
    throw e;
  }
}
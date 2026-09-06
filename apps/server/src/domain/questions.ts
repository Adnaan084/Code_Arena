/**
 * Question management: live CRUD, import/export, enable/disable.
 * Host can add/edit questions at any time; newly enabled questions appear
 * in the marketplace immediately if the game is in MARKET_OPEN/FINAL_MINUTE.
 */
import type { Game, Question } from '@prisma/client';
import {
  type AnswerData,
  type Difficulty,
  type GameConfig,
  type QuestionType,
  DIFFICULTIES,
  QUESTION_TYPES,
  QUESTION_CATEGORIES,
  gameConfigPatchSchema,
  questionUpsertSchema,
} from '@wcc/shared';
import type { DB } from '../lib/prisma';
import { AppError, conflict, notFound } from '../lib/errors';
import { createEvent } from './feed';
import { toQuestionAdmin, toMarketItem } from './serializers';

function assertInGame(q: Question, gameId: string) {
  if (q.gameId !== gameId) throw notFound('Question not found in this game.');
}

export async function listQuestions(db: DB, game: Game) {
  return (await db.question.findMany({ where: { gameId: game.id }, orderBy: { code: 'asc' } })).map(toQuestionAdmin);
}

export async function getQuestion(db: DB, game: Game, id: string): Promise<Question> {
  const q = await db.question.findUnique({ where: { id } });
  if (!q) throw notFound('Question not found.');
  assertInGame(q, game.id);
  return q;
}

export async function createQuestion(db: DB, game: Game, input: object) {
  const config = game.config as GameConfig;
  const parsed = questionUpsertSchema.parse(input);
  const existing = await db.question.findUnique({ where: { gameId_code: { gameId: game.id, code: parsed.code } } });
  if (existing) throw conflict(`A question with code ${parsed.code} already exists in this game.`);
  const q = await db.question.create({
    data: {
      gameId: game.id,
      code: parsed.code,
      type: parsed.type,
      difficulty: parsed.difficulty,
      category: parsed.category,
      title: parsed.title,
      body: parsed.body,
      codeSnippet: parsed.codeSnippet ?? null,
      answerData: parsed.answerData as object,
      price: parsed.price ?? config.priceTable[parsed.difficulty],
      reward: parsed.reward ?? config.rewardTable[parsed.difficulty],
      hint: parsed.hint ?? null,
      explanation: parsed.explanation ?? null,
      enabled: parsed.enabled ?? true,
      maxTrades: config.maxTradesPerQuestion,
    },
  });
  if (q.enabled) {
    await createEvent(db, game, 'QUESTION_ADDED', { questionCode: q.code });
  }
  return toQuestionAdmin(q);
}

export async function updateQuestion(db: DB, game: Game, id: string, input: object) {
  const config = game.config as GameConfig;
  const parsed = questionUpsertSchema.partial().parse(input);
  const q = await getQuestion(db, game, id);
  const data: Record<string, unknown> = { ...parsed };
  if (parsed.answerData) data.answerData = parsed.answerData;
  if (parsed.price === undefined) delete data.price;
  if (parsed.reward === undefined) delete data.reward;
  if (parsed.enabled !== undefined && !q.enabled && parsed.enabled) {
    await createEvent(db, game, 'QUESTION_ENABLED', { questionCode: q.code });
  } else if (parsed.enabled !== undefined && q.enabled && !parsed.enabled) {
    await createEvent(db, game, 'QUESTION_DISABLED', { questionCode: q.code });
  }
  const updated = await db.question.update({ where: { id }, data });
  return toQuestionAdmin(updated);
}

export async function deleteQuestion(db: DB, game: Game, id: string) {
  const q = await getQuestion(db, game, id);
  if (q.status === 'SOLD') throw conflict('Cannot delete a question that has been purchased.');
  await db.question.delete({ where: { id } });
}

export async function toggleEnabled(db: DB, game: Game, id: string, enabled: boolean) {
  const q = await getQuestion(db, game, id);
  if (q.enabled === enabled) return toQuestionAdmin(q);
  const updated = await db.question.update({ where: { id }, data: { enabled } });
  if (enabled) {
    await createEvent(db, game, 'QUESTION_ENABLED', { questionCode: q.code });
  } else {
    await createEvent(db, game, 'QUESTION_DISABLED', { questionCode: q.code });
  }
  return toQuestionAdmin(updated);
}

export async function importQuestions(db: DB, game: Game, items: object[]) {
  const config = game.config as GameConfig;
  const results = { created: 0, skipped: 0, errors: [] as string[] };
  for (const item of items) {
    try {
      const parsed = questionUpsertSchema.parse(item);
      const exists = await db.question.findUnique({ where: { gameId_code: { gameId: game.id, code: parsed.code } } });
      if (exists) {
        results.skipped += 1;
        results.errors.push(`${parsed.code}: already exists`);
        continue;
      }
      await db.question.create({
        data: {
          gameId: game.id,
          code: parsed.code,
          type: parsed.type,
          difficulty: parsed.difficulty,
          category: parsed.category,
          title: parsed.title,
          body: parsed.body,
          codeSnippet: parsed.codeSnippet ?? null,
          answerData: parsed.answerData as object,
          price: parsed.price ?? config.priceTable[parsed.difficulty],
          reward: parsed.reward ?? config.rewardTable[parsed.difficulty],
          hint: parsed.hint ?? null,
          explanation: parsed.explanation ?? null,
          enabled: parsed.enabled ?? true,
          maxTrades: config.maxTradesPerQuestion,
        },
      });
      results.created += 1;
    } catch (e) {
      results.errors.push(String(e));
    }
  }
  return results;
}

export async function exportQuestions(db: DB, game: Game) {
  const questions = await db.question.findMany({ where: { gameId: game.id }, orderBy: { code: 'asc' } });
  return questions.map((q) => ({
    code: q.code,
    type: q.type,
    difficulty: q.difficulty,
    category: q.category,
    title: q.title,
    body: q.body,
    codeSnippet: q.codeSnippet,
    price: q.price,
    reward: q.reward,
    hint: q.hint,
    explanation: q.explanation,
    enabled: q.enabled,
    answerData: q.answerData,
  }));
}

/** Marketplace view (team-facing). */
export async function listMarketplace(db: DB, game: Game, teamId: string, opts: {
  difficulty?: Difficulty;
  category?: string;
  sort?: 'price-asc' | 'reward-desc' | 'ratio-desc' | 'difficulty';
}) {
  return import('./market').then(({ listMarketplace }) => listMarketplace(db, game, teamId, opts));
}

export { DIFFICULTIES, QUESTION_TYPES, QUESTION_CATEGORIES };
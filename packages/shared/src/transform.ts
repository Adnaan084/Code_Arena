/**
 * Safe view-models. These functions are the ONLY place a question becomes a
 * payload a team client can see — and they guarantee the stored answer data
 * is never included. The host's full view (with answers) is a separate,
 * role-gated serializer.
 */
import type { AnswerData, Difficulty, QuestionPublic, QuestionStatus, QuestionType } from './types';

/** Minimal shape of a stored question row (Prisma row projected here). */
export interface QuestionRecordLike {
  id: string;
  code: string;
  type: QuestionType;
  difficulty: Difficulty;
  category: string;
  title: string;
  body: string;
  codeSnippet: string | null;
  answerData: AnswerData;
  price: number;
  reward: number;
  hint: string | null;
  /** Optional — not part of the team-facing view (host-only). */
  explanation?: string | null;
  /** Optional — not part of the team-facing view (host-only). */
  enabled?: boolean;
  status: QuestionStatus;
  tradeCount: number;
  maxTrades: number;
}

export function toQuestionPublic(q: QuestionRecordLike): QuestionPublic {
  const base = {
    id: q.id,
    code: q.code,
    type: q.type,
    difficulty: q.difficulty,
    category: q.category,
    title: q.title,
    body: q.body,
    snippet: q.codeSnippet,
    price: q.price,
    reward: q.reward,
    hint: q.hint,
    status: q.status,
    tradeCount: q.tradeCount,
    maxTrades: q.maxTrades,
    tradable: q.tradeCount < q.maxTrades,
  };
  switch (q.answerData.type) {
    case 'MULTIPLE_CHOICE':
      return { ...base, options: q.answerData.options };
    case 'CODING_CHALLENGE':
      return { ...base, sampleInput: q.answerData.sampleInput };
    default:
      return base;
  }
}
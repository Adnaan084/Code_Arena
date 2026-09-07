/**
 * DTO builders. These are the boundary between raw Prisma rows and wire
 * payloads, and the enforcement point for "never send the answer data to a
 * team client". Keep every leak-prone field out of these functions on purpose.
 */
import type {
  Announcement,
  AuditLog,
  Game,
  GameEvent,
  Question,
  QuestionOwnership,
  Team,
  Trade,
  TradeItem,
} from '@prisma/client';
import {
  type ActivityDto,
  type AnswerData,
  type AuditLogEntry,
  type GameConfig,
  type GameMeta,
  type InventoryItem,
  type LeaderboardRow,
  type MarketItem,
  type PhaseRules,
  type QuestionAdmin,
  type QuestionRecordLike,
  type TeamSummary,
  type TradeDto,
  effectiveState,
  phaseRules,
  remainingMs,
  toQuestionPublic,
  type GameState as SharedGameState,
} from '@wcc/shared';
import type { DB } from '../lib/prisma';
import { gameRules } from './wallet';

// Shared phaseRules expects a GameLike whose state is the shared string union,
// Prisma returns its own enum — the byte values match; convert at the seam.
const asSharedState = (s: string): SharedGameState => s as SharedGameState;

const asRecord = (q: Question): QuestionRecordLike =>
  ({
    id: q.id,
    code: q.code,
    type: q.type,
    difficulty: q.difficulty,
    category: q.category,
    title: q.title,
    body: q.body,
    codeSnippet: q.codeSnippet,
    answerData: q.answerData as AnswerData,
    price: q.price,
    reward: q.reward,
    hint: q.hint,
    status: q.status,
    tradeCount: q.tradeCount,
    maxTrades: q.maxTrades,
  }) as QuestionRecordLike;

export function toGameMeta(
  game: Pick<
    Game,
    'id' | 'code' | 'title' | 'state' | 'config' | 'startTime' | 'endTime' | 'pausedAt' | 'pausedTotalMs'
  >,
  announcements: Pick<Announcement, 'id' | 'message' | 'createdAt'>[],
  lastEventSeq: bigint | number,
  now = new Date(),
): GameMeta {
  const config = (game.config ?? {}) as GameConfig;
  const g = { state: asSharedState(game.state), pausedAt: game.pausedAt, startTime: game.startTime, endTime: game.endTime };
  const phase: PhaseRules = phaseRules({ ...g, phaseStartedAt: game.startTime }, gameRules(config), now);
  return {
    id: game.id,
    code: game.code,
    title: game.title,
    state: effectiveState(g, now),
    phase,
    startTime: game.startTime?.toISOString() ?? null,
    endTime: game.endTime?.toISOString() ?? null,
    remainingMs: remainingMs(g, now),
    maxTeams: config.maxTeams,
    playersPerTeam: config.playersPerTeam,
    gameDurationMinutes: config.gameDurationMinutes,
    startingCoins: config.startingCoins,
    announcements: announcements.map((a) => ({ id: a.id, message: a.message, createdAt: a.createdAt.toISOString() })),
    lastEventSeq: Number(lastEventSeq),
  };
}

/** Audit row → wire DTO (detail is a JSON column; the client renders it verbatim). */
export function toAuditLogEntry(a: Pick<AuditLog, 'id' | 'actorType' | 'actorName' | 'action' | 'detail' | 'createdAt'>): AuditLogEntry {
  return {
    id: a.id,
    actorType: a.actorType as AuditLogEntry['actorType'],
    actorName: a.actorName,
    action: a.action,
    detail: a.detail as unknown,
    createdAt: a.createdAt.toISOString(),
  };
}

export function toTeamSummary(
  t: Pick<
    Team,
    | 'id'
    | 'name'
    | 'coins'
    | 'score'
    | 'solvedCount'
    | 'purchasedCount'
    | 'failedCount'
    | 'tradeCount'
    | 'status'
    | 'joinOrder'
    | 'online'
  >,
): TeamSummary {
  return {
    id: t.id,
    name: t.name,
    coins: t.coins,
    score: t.score,
    solvedCount: t.solvedCount,
    purchasedCount: t.purchasedCount,
    failedCount: t.failedCount,
    tradeCount: t.tradeCount,
    status: t.status,
    joinOrder: t.joinOrder,
    online: t.online,
  };
}

export function toLeaderboard(
  teams: Pick<Team, 'name' | 'score' | 'coins' | 'solvedCount' | 'purchasedCount' | 'tradeCount' | 'status'>[],
  opts: { excludeDisqualified?: boolean } = { excludeDisqualified: true },
): LeaderboardRow[] {
  const filtered = opts.excludeDisqualified ? teams.filter((t) => t.status === 'ACTIVE') : teams;
  const sorted = [...filtered].sort((a, b) => b.score - a.score || b.coins - a.coins || a.name.localeCompare(b.name));
  return sorted.map((t, i) => ({
    rank: i + 1,
    teamName: t.name,
    score: t.score,
    coins: t.coins,
    solved: t.solvedCount,
    purchased: t.purchasedCount,
    trades: t.tradeCount,
  }));
}

export function toActivity(
  e: Pick<GameEvent, 'id' | 'type' | 'message' | 'questionCode' | 'at'> & { team?: { name: string } | null },
): ActivityDto {
  return {
    seq: Number(e.id),
    type: e.type,
    message: e.message,
    teamName: e.team?.name ?? null,
    questionCode: e.questionCode,
    at: e.at.toISOString(),
  };
}

export function toMarketItem(
  q: Question & { ownership?: { teamId: string } | null },
  myTeamId: string,
): MarketItem {
  return { ...toQuestionPublic(asRecord(q)), purchasedByMe: q.ownership?.teamId === myTeamId };
}

export function toInventoryItem(o: QuestionOwnership & { question: Question }, maxAttempts: number): InventoryItem {
  return {
    ownershipId: o.id,
    question: toQuestionPublic(asRecord(o.question)),
    status: o.status,
    attemptsUsed: o.attemptsUsed,
    maxAttempts,
    purchasedAt: o.purchasedAt.toISOString(),
  };
}

export function toQuestionAdmin(q: Question): QuestionAdmin {
  return { ...toQuestionPublic(asRecord(q)), answerData: q.answerData as AnswerData, explanation: q.explanation, enabled: q.enabled };
}

export type TradeWithRelations = Trade & {
  fromTeam: { id: string; name: string };
  toTeam: { id: string; name: string };
  items: (TradeItem & { question: Question })[];
};

export function toTradeDto(trade: TradeWithRelations, viewerTeamId?: string): TradeDto {
  const offered = trade.items
    .filter((i) => i.role === 'OFFERED')
    .map((i) => ({ id: i.question.id, code: i.question.code, title: i.question.title, difficulty: i.question.difficulty }));
  const requested = trade.items
    .filter((i) => i.role === 'REQUESTED')
    .map((i) => ({ id: i.question.id, code: i.question.code, title: i.question.title, difficulty: i.question.difficulty }));
  return {
    id: trade.id,
    direction: viewerTeamId ? (trade.fromTeamId === viewerTeamId ? 'OUT' : 'IN') : 'IN',
    state: trade.state,
    coins: trade.coins,
    expiresAt: trade.expiresAt.toISOString(),
    createdAt: trade.createdAt.toISOString(),
    fromTeam: { id: trade.fromTeam.id, name: trade.fromTeam.name },
    toTeam: { id: trade.toTeam.id, name: trade.toTeam.name },
    offered,
    requested,
  };
}

/** Latest event seq of a game (0 when none). */
export async function currentSeq(db: DB, gameId: string): Promise<number> {
  const row = await db.gameEvent.findFirst({ where: { gameId }, orderBy: { id: 'desc' }, select: { id: true } });
  return row ? Number(row.id) : 0;
}
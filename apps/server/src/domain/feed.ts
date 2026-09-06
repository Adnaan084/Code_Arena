import type { Game, GameEvent, GameEventType } from '@prisma/client';
import { activityMessage, type ActivityCtx } from '@wcc/shared';
import type { DB, Tx } from '../lib/prisma';

export interface EventCtx extends ActivityCtx {
  teamId?: string | null;
  payload?: unknown;
}

/**
 * Persist one domain event (inside a transaction or standalone).
 *
 * Returns the event as a JSON-safe shape: GameEvent.id is a BigInt, which
 * JSON.stringify (res.json / socket.io serialization) cannot encode and would
 * throw on. We keep every field but represent the id as a string; the PRISM-
 * side seq lookup (currentSeq / recentEvents) still reads the BigInt column.
 */
export async function createEvent(
  db: DB | Tx,
  game: { id: string },
  type: GameEventType,
  ctx: EventCtx = {},
): Promise<Omit<GameEvent, 'id'> & { id: string }> {
  const message = activityMessage(type, {
    teamName: ctx.teamName ?? null,
    otherTeamName: ctx.otherTeamName ?? null,
    questionCode: ctx.questionCode ?? null,
    amount: ctx.amount ?? null,
    message: ctx.message ?? null,
  });
  const row = await db.gameEvent.create({
    data: {
      gameId: game.id,
      type,
      teamId: ctx.teamId ?? null,
      questionCode: ctx.questionCode ?? null,
      payload: (ctx.payload ?? {}) as object,
      message,
    },
  });
  return { ...row, id: row.id.toString() };
}

export type ActivityQuery = Pick<GameEvent, 'id' | 'type' | 'message' | 'questionCode' | 'at'> & {
  team?: { name: string } | null;
};

/** Most recent persisted events, newest first. */
export async function recentEvents(db: DB, gameId: string, sinceSeq?: number, limit = 100): Promise<ActivityQuery[]> {
  const events = await db.gameEvent.findMany({
    where: { gameId, ...(sinceSeq ? { id: { gt: sinceSeq } } : {}) },
    orderBy: { id: 'desc' },
    take: limit,
    include: { team: { select: { name: true } } },
  });
  return events.reverse();
}

/** Append a host/system audit trail entry. */
export async function auditAction(
  db: DB,
  game: Pick<Game, 'id'>,
  action: string,
  opts: { actorType?: 'HOST' | 'SYSTEM' | 'TEAM'; actorName?: string | null; detail?: unknown; reason?: string | null } = {},
): Promise<void> {
  await db.auditLog.create({
    data: {
      gameId: game.id,
      actorType: opts.actorType ?? 'HOST',
      actorName: opts.actorName ?? null,
      action,
      detail: (opts.detail ?? {}) as object,
      reason: opts.reason ?? null,
    },
  });
}
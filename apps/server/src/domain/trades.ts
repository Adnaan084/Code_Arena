/**
 * Trading: propose / accept / reject / cancel / expire.
 *
 * Accept serializes on a single conditional claim (UPDATE ... WHERE state='OPEN')
 * inside one transaction. Whichever accept wins transfers BOTH question
 * ownerships (by moving the unique ownership rows, guaranteeing a question can
 * never exist under two teams) plus the coin pot, commits, and the losing
 * accept — even one racing simultaneously — sees count 0 and fails safely.
 */
import type { Game, Question, QuestionOwnership } from '@prisma/client';
import { type GameConfig, type TradeTarget, phaseRules, toQuestionPublic } from '@wcc/shared';
import type { DB, Tx } from '../lib/prisma';
import { AppError, conflict, forbidden, isPrismaUniqueViolation, notFound } from '../lib/errors';
import { gameRules, changeCoins, refreshScore } from './wallet';
import { createEvent } from './feed';
import { toTradeDto, asRecord, type TradeWithRelations } from './serializers';

const tradeStateError = (m: string) => new AppError(409, 'TRADE_STATE', m);

const canTradeNow = (game: Game, config: GameConfig): void => {
  const rules = phaseRules(
    { state: game.state, pausedAt: game.pausedAt, startTime: game.startTime, endTime: game.endTime, phaseStartedAt: game.startTime },
    gameRules(config),
    new Date(),
  );
  if (!rules.canTrade) {
    throw new AppError(409, 'TRADING_CLOSED', 'Trading is closed right now.');
  }
};

export interface ProposeInput {
  targetTeamId: string;
  offeredQuestionId: string;
  requestedQuestionId: string;
  coins: number;
  idempotencyKey?: string;
}

export async function proposeTrade(db: DB, game: Game, fromTeamId: string, input: ProposeInput) {
  const config = game.config as GameConfig;
  canTradeNow(game, config);
  const none: Awaited<ReturnType<typeof createEvent>>[] = [];

  if (input.targetTeamId === fromTeamId) throw new AppError(422, 'SELF_TRADE', 'A team cannot trade with itself.');
  if (input.coins < 0) throw new AppError(422, 'BAD_TRADE', 'Offered coins cannot be negative.');

  try {
    return await db.$transaction(async (tx) => {
      const from = await tx.team.findUnique({ where: { id: fromTeamId }, select: { id: true, name: true, status: true, coins: true } });
      const to = await tx.team.findUnique({ where: { id: input.targetTeamId }, select: { id: true, name: true, status: true, coins: true } });
      if (!from) throw notFound('Your team was not found.');
      if (!to) throw notFound('The target team was not found.');
      if (from.status !== 'ACTIVE' || to.status !== 'ACTIVE') throw forbidden('One of the teams is not active.');

      if (input.idempotencyKey) {
        const prior = await tx.trade.findUnique({
          where: { gameId_fromTeamId_idempotencyKey: { gameId: game.id, fromTeamId, idempotencyKey: input.idempotencyKey } },
        });
        if (prior) return { tradeId: prior.id, already: true, events: none };
      }

      if (input.coins > from.coins) throw conflict('Your team cannot offer more coins than it has.');

      const offered = await tx.questionOwnership.findUnique({ where: { questionId: input.offeredQuestionId }, include: { question: true } });
      const requested = await tx.questionOwnership.findUnique({ where: { questionId: input.requestedQuestionId }, include: { question: true } });

      const assertTradable = (
        o: (QuestionOwnership & { question: Question }) | null,
        expectedTeamId: string,
        side: 'offered' | 'requested',
      ) => {
        if (!o || o.teamId !== expectedTeamId) {
          throw conflict(`The question you ${side === 'offered' ? 'are offering' : 'are requesting'} is no longer owned by the expected team.`);
        }
        if (o.status !== 'UNSOLVED') throw conflict('Solved and failed questions cannot be traded.');
        if (o.tradeLock) throw conflict('That question is already tied up in another pending trade.');
        if (o.question.tradeCount >= o.question.maxTrades) {
          throw conflict(`That question has reached its max trades (${o.question.maxTrades}).`);
        }
      };
      assertTradable(offered, fromTeamId, 'offered');
      assertTradable(requested, input.targetTeamId, 'requested');

      if (offered!.questionId === requested!.questionId) throw new AppError(422, 'SAME_QUESTION', 'A trade cannot involve the same question twice.');

      const trade = await tx.trade.create({
        data: {
          gameId: game.id,
          fromTeamId,
          toTeamId: input.targetTeamId,
          coins: input.coins,
          expiresAt: new Date(Date.now() + config.tradeTTLSeconds * 1000),
          idempotencyKey: input.idempotencyKey ?? null,
          items: {
            create: [
              { role: 'OFFERED', questionId: offered!.questionId },
              { role: 'REQUESTED', questionId: requested!.questionId },
            ],
          },
        },
      });
      await tx.questionOwnership.updateMany({
        where: { questionId: { in: [offered!.questionId, requested!.questionId] } },
        data: { tradeLock: true },
      });
      const ev = await createEvent(tx, game, 'TRADE_CREATED', {
        teamId: fromTeamId,
        teamName: from.name,
        otherTeamName: to.name,
        payload: { tradeId: trade.id },
      });
      return { tradeId: trade.id, already: false, events: [ev] };
    });
  } catch (e) {
    if (input.idempotencyKey && isPrismaUniqueViolation(e)) {
      const prior = await db.trade.findUnique({
        where: { gameId_fromTeamId_idempotencyKey: { gameId: game.id, fromTeamId, idempotencyKey: input.idempotencyKey } },
      });
      if (prior) return { tradeId: prior.id, already: true, events: none };
    }
    throw e;
  }
}

const tradeWithRelations = {
  fromTeam: { select: { id: true, name: true } as const },
  toTeam: { select: { id: true, name: true } as const },
  items: { include: { question: true } as const },
};

async function lockAndLoad(db: Tx, tradeId: string): Promise<TradeWithRelations> {
  const trade = await db.trade.findUnique({ where: { id: tradeId }, include: tradeWithRelations });
  if (!trade) throw notFound('Trade offer not found.');
  return trade as unknown as TradeWithRelations;
}

async function expireIfStale(tx: Tx, trade: TradeWithRelations): Promise<boolean> {
  if (trade.state === 'OPEN' && trade.expiresAt.getTime() <= Date.now()) {
    await tx.trade.update({ where: { id: trade.id }, data: { state: 'EXPIRED', resolvedAt: new Date() } });
    const qids = trade.items.map((i) => i.questionId);
    await tx.questionOwnership.updateMany({ where: { questionId: { in: qids } }, data: { tradeLock: false } });
    return true;
  }
  return false;
}

export async function acceptTrade(db: DB, game: Game, tradeId: string, teamId: string) {
  const config = game.config as GameConfig;
  canTradeNow(game, config);

  return db.$transaction(async (tx) => {
    const trade = await lockAndLoad(tx, tradeId);
    if (trade.toTeamId !== teamId) throw forbidden('Only the receiving team can accept this trade.');
    if (trade.state !== 'OPEN') throw tradeStateError('This trade is no longer open.');
    if (await expireIfStale(tx, trade)) throw conflict('This trade offer has expired.');

    const claimed = await tx.trade.updateMany({
      where: { id: trade.id, state: 'OPEN' },
      data: { state: 'EXECUTED', executedAt: new Date(), resolvedAt: new Date() },
    });
    if (claimed.count !== 1) throw tradeStateError('This trade was just resolved by someone else.');

    // Refetch with relations so the response reflects EXECUTED state + updated timestamps.
    const freshTrade = await lockAndLoad(tx, trade.id);

    const offered = freshTrade.items.filter((i) => i.role === 'OFFERED');
    const requested = freshTrade.items.filter((i) => i.role === 'REQUESTED');

    for (const item of offered) {
      const o = await tx.questionOwnership.findUnique({ where: { questionId: item.questionId } });
      if (!o || o.teamId !== trade.fromTeamId || o.status !== 'UNSOLVED') {
        throw tradeStateError('Something changed about the offered question. The trade was cancelled.');
      }
    }
    for (const item of requested) {
      const o = await tx.questionOwnership.findUnique({ where: { questionId: item.questionId } });
      if (!o || o.teamId !== trade.toTeamId || o.status !== 'UNSOLVED') {
        throw tradeStateError('Something changed about the requested question. The trade was cancelled.');
      }
    }

    if (trade.coins > 0) {
      await changeCoins(tx, { gameId: game.id, teamId: trade.fromTeamId, delta: -trade.coins, type: 'TRADE_OUT', tradeId: trade.id, reason: `Trade #${trade.id.slice(0, 8)} coins` });
    }
    const toBalanceAfter = await changeCoins(tx, { gameId: game.id, teamId: trade.toTeamId, delta: trade.coins, type: 'TRADE_IN', tradeId: trade.id, reason: `Trade #${trade.id.slice(0, 8)} coins` });

    for (const item of offered) {
      await tx.questionOwnership.update({ where: { questionId: item.questionId }, data: { teamId: trade.toTeamId, tradeLock: false } });
    }
    for (const item of requested) {
      await tx.questionOwnership.update({ where: { questionId: item.questionId }, data: { teamId: trade.fromTeamId, tradeLock: false } });
    }
    await tx.question.updateMany({
      where: { id: { in: [...offered.map((i) => i.questionId), ...requested.map((i) => i.questionId)] } },
      data: { tradeCount: { increment: 1 } },
    });
    await tx.team.update({ where: { id: trade.fromTeamId }, data: { tradeCount: { increment: 1 } } });
    await tx.team.update({ where: { id: trade.toTeamId }, data: { tradeCount: { increment: 1 } } });
    await refreshScore(tx, config, trade.fromTeamId);
    await refreshScore(tx, config, trade.toTeamId);

    const ev = await createEvent(tx, game, 'TRADE_ACCEPTED', {
      teamId: trade.toTeamId,
      teamName: freshTrade.toTeam.name,
      otherTeamName: freshTrade.fromTeam.name,
      payload: { tradeId: trade.id },
    });
    return { trade: freshTrade, toBalanceAfter, events: [ev] };
  });
}

async function resolveTrade(tx: Tx, trade: TradeWithRelations, next: 'REJECTED' | 'CANCELLED', game: Game) {
  const claimed = await tx.trade.updateMany({
    where: { id: trade.id, state: 'OPEN' },
    data: { state: next, resolvedAt: new Date() },
  });
  if (claimed.count !== 1) throw tradeStateError('This trade is no longer open.');
  const qids = trade.items.map((i) => i.questionId);
  await tx.questionOwnership.updateMany({ where: { questionId: { in: qids } }, data: { tradeLock: false } });
  const type = next === 'REJECTED' ? 'TRADE_REJECTED' : ('TRADE_CANCELLED' as const);
  return createEvent(tx, game, type, {
    teamId: next === 'REJECTED' ? trade.toTeamId : trade.fromTeamId,
    teamName: next === 'REJECTED' ? trade.toTeam.name : trade.fromTeam.name,
    otherTeamName: next === 'REJECTED' ? trade.fromTeam.name : trade.toTeam.name,
    payload: { tradeId: trade.id },
  });
}

export async function rejectTrade(db: DB, game: Game, tradeId: string, teamId: string) {
  return db.$transaction(async (tx) => {
    const trade = await lockAndLoad(tx, tradeId);
    if (trade.toTeamId !== teamId) throw forbidden('Only the receiving team can reject this trade.');
    const ev = await resolveTrade(tx, trade, 'REJECTED', game);
    return { ok: true, events: [ev] };
  });
}

export async function cancelTrade(db: DB, game: Game, tradeId: string, teamId: string) {
  return db.$transaction(async (tx) => {
    const trade = await lockAndLoad(tx, tradeId);
    if (trade.fromTeamId !== teamId) throw forbidden('Only the offering team can cancel this trade.');
    const ev = await resolveTrade(tx, trade, 'CANCELLED', game);
    return { ok: true, events: [ev] };
  });
}

/** Sweep expired open trades (run by the timer pulse). Returns events to broadcast. */
export async function expireStaleTrades(db: DB, game: Game) {
  const stale = await db.trade.findMany({
    where: { gameId: game.id, state: 'OPEN', expiresAt: { lte: new Date() } },
  });
  const events: Awaited<ReturnType<typeof createEvent>>[] = [];
  for (const trade of stale) {
    let expired = false;
    const items = await db.$transaction(async (tx) => {
      const claimed = await tx.trade.updateMany({
        where: { id: trade.id, state: 'OPEN' },
        data: { state: 'EXPIRED', resolvedAt: new Date() },
      });
      if (claimed.count !== 1) return null;
      expired = true;
      const it = await tx.tradeItem.findMany({ where: { tradeId: trade.id } });
      await tx.questionOwnership.updateMany({ where: { questionId: { in: it.map((i) => i.questionId) } }, data: { tradeLock: false } });
      return it;
    });
    if (items && expired) {
      events.push(await createEvent(db, game, 'TRADE_EXPIRED', { teamId: trade.fromTeamId, payload: { tradeId: trade.id } }));
    }
  }
  return events;
}

export async function listTrades(db: DB, game: Game, teamId: string) {
  const trades = await db.trade.findMany({
    where: { gameId: game.id, OR: [{ fromTeamId: teamId }, { toTeamId: teamId }] },
    orderBy: { createdAt: 'desc' },
    include: tradeWithRelations,
  });
  return (trades as unknown as TradeWithRelations[]).map((t) => toTradeDto(t, teamId));
}

/**
 * Read-only: every ACTIVE team a client could trade with, plus the questions
 * it can currently give up (owned, UNSOLVED, not tied up in a pending trade,
 * under its max trades). Feeds the propose-trade picker; the server remains
 * authoritative on everything at propose time.
 */
export async function listTradeTargets(db: DB, game: Game, myTeamId: string): Promise<TradeTarget[]> {
  const teams = await db.team.findMany({
    where: { gameId: game.id, status: 'ACTIVE', NOT: { id: myTeamId } },
    orderBy: { joinOrder: 'asc' },
    select: { id: true, name: true },
  });
  if (teams.length === 0) return [];

  const ownerships = await db.questionOwnership.findMany({
    where: {
      gameId: game.id,
      teamId: { in: teams.map((t) => t.id) },
      status: 'UNSOLVED',
      tradeLock: false,
    },
    include: { question: true },
  });

  const byTeam = new Map<string, TradeTarget['tradable']>();
  for (const o of ownerships) {
    if (o.question.tradeCount >= o.question.maxTrades) continue;
    const list = byTeam.get(o.teamId) ?? [];
    list.push(toQuestionPublic(asRecord(o.question)));
    byTeam.set(o.teamId, list);
  }

  return teams.map((t) => ({ teamId: t.id, teamName: t.name, tradable: byTeam.get(t.id) ?? [] }));
}
/** Socket.IO server: room-based realtime, time sync pulse, reconnect resync. */
import { Server as IOServer } from 'socket.io';
import { createServer, Server as HttpServer } from 'http';
import type { Express } from 'express';
import { prisma } from '../lib/prisma';
import { sha256 } from '../auth/tokens';
import { toGameMeta, toLeaderboard, currentSeq, toActivity, toTeamSummary, toMarketItem, toTradeDto, toInventoryItem, toAuditLogEntry } from '../domain/serializers';
import { advancePhaseIfNeeded } from '../domain/games';
import { listQuestions } from '../domain/questions';
import { getTransactions, getAuditLog, listPurchases } from '../domain/admin';
import { expireStaleTrades, listHostTrades } from '../domain/trades';
import { effectiveState, phaseRules, type RuleConfig } from '@wcc/shared';

export interface SioHandle {
  /** Broadcast domain events to the game room (host + team + display sockets). */
  emitGameEvents(gameCode: string, events: Array<{ type: string; t: number; questionCode?: string }>): void;
}

/** Persisted domain event → wire broadcast shape ({ at } → { t }). */
function toWireEvent(e: { type: string; at: Date; questionCode: string | null }): { type: string; t: number; questionCode?: string } {
  return {
    type: e.type,
    t: e.at.getTime(),
    ...(e.questionCode ? { questionCode: e.questionCode } : {}),
  };
}

/**
 * A single authoritative timer pulse feeds every game's phase advancement and
 * stale-trade sweep, then pushes a time sync. A `pulseRunning` guard keeps the
 * pulse non-overlapping so the clock (and the transitions it drives) can never
 * be mutated by two ticks at once. All transitions themselves are idempotent
 * conditional claims, so even overlapping pulses (e.g. a second server process)
 * would be safe.
 */
export function createSocketServer(app: Express, http: HttpServer) {
  const io = new IOServer(http, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    transports: ['websocket', 'polling'],
  });

  const handle: SioHandle = {
    emitGameEvents(gameCode: string, events: Array<{ type: string; t: number; questionCode?: string }>) {
      for (const e of events) {
        // Room-scoped: only sockets in this game receive its events.
        io.to(`game:${gameCode}`).emit('game:event', e);
        // GAME_RELOAD triggers a full authoritative resync on all clients.
        if (e.type === 'GAME_RELOAD') {
          io.to(`game:${gameCode}`).emit('reload', { reason: 'game reset' });
        }
      }
    },
  };

  io.on('connection', (sock) => {
    const q = sock.handshake.query;
    const gameCode = String(q.gameCode ?? '');
    const token = String(q.token ?? '');
    const role = String(q.role ?? 'team');
    const lastSeq = String(q.lastSeq ?? '0');

    if (!gameCode) {
      sock.emit('error', { code: 'UNAUTHORIZED', message: 'Missing gameCode' });
      sock.disconnect(true);
      return;
    }

    (async () => {
      const game = await prisma.game.findUnique({ where: { code: gameCode.toUpperCase() } });
      if (!game) {
        sock.emit('error', { code: 'NOT_FOUND', message: 'Game not found' });
        sock.disconnect(true);
        return;
      }

      const isDisplay = role === 'display';
      if (!token && !isDisplay) {
        sock.emit('error', { code: 'UNAUTHORIZED', message: 'Missing token' });
        sock.disconnect(true);
        return;
      }
      const hash = token ? sha256(token) : '';

      if (role === 'host') {
        if (game.hostTokenHash !== hash) {
          sock.emit('error', { code: 'UNAUTHORIZED', message: 'Invalid host token' });
          sock.disconnect(true);
          return;
        }
        sock.join(`host:${game.code}`);
        sock.join(`game:${game.code}`);
      } else if (isDisplay) {
        // Public projector: no auth beyond a valid game code; joins the game room
        // so it receives state:sync, time:sync and game:event exactly like players.
        sock.join(`game:${game.code}`);
      } else {
        const team = await prisma.team.findFirst({ where: { gameId: game.id, accessTokenHash: hash } });
        if (!team) {
          sock.emit('error', { code: 'UNAUTHORIZED', message: 'Invalid team token' });
          sock.disconnect(true);
          return;
        }
        sock.join(`game:${game.code}`);
        sock.join(`team:${team.id}`);
        await prisma.team.update({ where: { id: team.id }, data: { online: true, disconnectedAt: null } });
        // Both hosts and teammates see presence so "1/2 connected" is visible in-app.
        const connectedCount = (await io.in(`team:${team.id}`).fetchSockets()).length;
        const presence = { teamId: team.id, name: team.name, online: true, connectedCount, disconnectedAt: null };
        io.to(`host:${game.code}`).emit('team:presence', presence);
        io.to(`team:${team.id}`).emit('team:presence', presence);
      }

      await sendState(sock, game.code, token, role, Number(lastSeq ?? 0));

      sock.on('req:state', async () => {
        await sendState(sock, game.code, token, role, Number(lastSeq ?? 0));
      });
    })();

    sock.on('disconnect', async () => {
      const token = String((sock.handshake.query as any)?.token ?? '');
      // Display sockets carry no token; nothing to mark presence for.
      if (!token) return;
      const team = await prisma.team.findFirst({
        where: { accessTokenHash: sha256(token) },
      });
      if (team) {
        const others = await io.in(`team:${team.id}`).fetchSockets();
        const game = await prisma.game.findUnique({ where: { id: team.gameId } });
        if (!game) return;
        const connectedCount = others.length;
        if (connectedCount === 0) {
          await prisma.team.update({ where: { id: team.id }, data: { online: false, disconnectedAt: new Date() } });
        }
        const presence = {
          teamId: team.id,
          name: team.name,
          online: connectedCount > 0,
          connectedCount,
          disconnectedAt: connectedCount === 0 ? new Date().toISOString() : null,
        };
        io.to(`host:${game.code}`).emit('team:presence', presence);
        io.to(`team:${team.id}`).emit('team:presence', presence);
      }
    });
  });

  async function sendState(sock: import('socket.io').Socket, code: string, token: string, role: string, sinceSeq: number) {
    const game = await prisma.game.findUnique({ where: { code } });
    if (!game) return;
    const seq = await currentSeq(prisma, game.id);
    const meta = toGameMeta(game, await prisma.announcement.findMany({ where: { gameId: game.id }, orderBy: { createdAt: 'desc' }, take: 10 }), seq);
    const lb = toLeaderboard(await prisma.team.findMany({ where: { gameId: game.id } }));
    const activityRaw = await prisma.gameEvent.findMany({
      where: { gameId: game.id, ...(sinceSeq ? { id: { gt: sinceSeq } } : {}) },
      orderBy: { id: 'asc' },
      take: 100,
      include: { team: { select: { name: true } } },
    });
    const activity = activityRaw.map(toActivity);

    if (role === 'display') {
      sock.emit('state:sync', { meta, leaderboard: lb, recentActivity: [...activity].reverse(), lastEventSeq: seq });
      return;
    }

    const hash = sha256(token);
    const isHost = game.hostTokenHash === hash;
    if (isHost) {
      // Host dashboard gets the full role-shaped snapshot: teams plus the
      // question bank, transaction ledger, audit trail and the cross-team
      // purchase surface it renders (refund administration reads these).
      const [teams, questions, transactions, audit, purchases, trades] = await Promise.all([
        prisma.team.findMany({ where: { gameId: game.id }, orderBy: { joinOrder: 'asc' } }).then((rows) => rows.map(toTeamSummary)),
        listQuestions(prisma, game),
        getTransactions(prisma, game),
        getAuditLog(prisma, game),
        listPurchases(prisma, game),
        listHostTrades(prisma, game),
      ]);
      sock.emit('state:sync', {
        meta,
        teams,
        questions,
        activity,
        transactions,
        audit: audit.map(toAuditLogEntry),
        purchases,
        trades,
        leaderboard: lb,
        lastEventSeq: seq,
      });
    } else {
      const team = await prisma.team.findFirst({ where: { gameId: game.id, accessTokenHash: hash } });
      if (!team) return;
      const marketplaceRaw = await prisma.question.findMany({ where: { gameId: game.id, enabled: true, status: 'AVAILABLE' }, include: { ownership: { select: { teamId: true } } } });
      const marketplace = marketplaceRaw.map((q) => toMarketItem(q, team.id));
      const ownerships = await prisma.questionOwnership.findMany({ where: { gameId: game.id, teamId: team.id }, include: { question: true } });
      const inventory = ownerships.map((o) => toInventoryItem(o, (game.config as { maxAttempts?: number }).maxAttempts ?? 1));
      const tradesRaw = await prisma.trade.findMany({
        where: { gameId: game.id, OR: [{ fromTeamId: team.id }, { toTeamId: team.id }] },
        orderBy: { createdAt: 'desc' },
        include: { fromTeam: { select: { id: true, name: true } }, toTeam: { select: { id: true, name: true } }, items: { include: { question: true } } },
      });
      const trades = tradesRaw.map((t) => toTradeDto(t as any, team.id));
      const transactions = await prisma.transaction.findMany({ where: { gameId: game.id, teamId: team.id }, orderBy: { createdAt: 'desc' }, take: 50 });
      sock.emit('state:sync', { meta, team: toTeamSummary(team), marketplace, inventory, trades, transactions, leaderboard: lb, activity, lastEventSeq: seq });
    }
  }

  // ── Authoritative timer pulse (single driver, never overlapping) ──────
  let pulseRunning = false;
  /**
   * Run one full pulse over every game: advance persisted phase transitions,
   * sweep stale trade offers, then push a time sync to each game room. The
   * auto-interval calls this once a second; it is also exported so the test
   * harness can drive a *single* deterministic pulse (tests stop the interval
   * to avoid racing a live clock against explicit timestamps).
   */
  const runPulse = async () => {
    if (pulseRunning) return;
    pulseRunning = true;
    try {
      const games = await prisma.game.findMany();
      for (const game of games) {
        // 1. Advance persisted phase transitions as the clock crosses boundaries.
        const phaseEvents = await advancePhaseIfNeeded(prisma, game.id);
        if (phaseEvents.length) handle.emitGameEvents(game.code, phaseEvents.map(toWireEvent));

        // 2. Sweep stale open trade offers (conditional claims → idempotent).
        const tradeEvents = await expireStaleTrades(prisma, game);
        if (tradeEvents.length) handle.emitGameEvents(game.code, tradeEvents.map(toWireEvent));

        // 3. Push the authoritative clock + derived phase to every socket.
        const g = { state: game.state, pausedAt: game.pausedAt, startTime: game.startTime, endTime: game.endTime };
        const remaining = game.endTime ? Math.max(0, game.endTime.getTime() - Date.now()) : null;
        if (remaining === null) continue;
        const cfg = (game.config ?? {}) as { gameDurationMinutes?: number; tradeWindowMinutes?: number; allowSubmitAfterClose?: boolean };
        const gameDurationMinutes = cfg.gameDurationMinutes ?? 30;
        const rules: RuleConfig = {
          gameDurationMinutes,
          tradeWindowMinutes: cfg.tradeWindowMinutes ?? 30,
          allowSubmitAfterClose: cfg.allowSubmitAfterClose ?? false,
        };
        const phase = phaseRules({ ...g, phaseStartedAt: game.startTime }, rules, new Date());
        const state = effectiveState(g, new Date());
        io.to(`game:${game.code}`).emit('time:sync', { remainingMs: remaining, totalMs: gameDurationMinutes * 60_000, state, phase });
      }
    } catch (e) {
      console.error('time-sync error', e);
    } finally {
      pulseRunning = false;
    }
  };
  const timeTimer = setInterval(() => {
    void runPulse();
  }, 1000);

  process.on('beforeExit', () => clearInterval(timeTimer));

  return { io, handle, timeTimer, runPulse };
}

export type SocketServerHandle = ReturnType<typeof createSocketServer>;
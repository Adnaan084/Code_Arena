/** Socket.IO server: room-based realtime, time sync pulse, reconnect resync. */
import { Server as IOServer } from 'socket.io';
import { createServer, Server as HttpServer } from 'http';
import type { Express } from 'express';
import { prisma } from '../lib/prisma';
import { sha256 } from '../auth/tokens';
import { toGameMeta, toLeaderboard, currentSeq, toActivity, toTeamSummary, toMarketItem, toTradeDto, toInventoryItem } from '../domain/serializers';
import { effectiveState, phaseRules, type RuleConfig } from '@wcc/shared';

export interface SioHandle {
  emitGameEvents(events: Array<{ type: string; t: number; questionCode?: string }>): void;
}

export function createSocketServer(app: Express, http: HttpServer) {
  const io = new IOServer(http, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    transports: ['websocket', 'polling'],
  });

  io.on('connection', (sock) => {
    const { gameCode, token, role, lastSeq } = sock.handshake.query as Record<string, string>;

    if (!gameCode || !token) {
      sock.emit('error', { code: 'UNAUTHORIZED', message: 'Missing gameCode or token' });
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

      const hash = sha256(token);
      if (role === 'host') {
        if (game.hostTokenHash !== hash) {
          sock.emit('error', { code: 'UNAUTHORIZED', message: 'Invalid host token' });
          sock.disconnect(true);
          return;
        }
        sock.join(`host:${game.code}`);
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
        await prisma.team.update({ where: { id: team.id }, data: { online: true } });
        io.to(`host:${game.code}`).emit('team:presence', { teamId: team.id, name: team.name, online: true });
      }

      await sendState(sock, game.code, token, Number(lastSeq ?? 0));

      sock.on('req:state', async () => {
        await sendState(sock, game.code, token, Number(lastSeq ?? 0));
      });
    })();

    sock.on('disconnect', async () => {
      const team = await prisma.team.findFirst({
        where: { accessTokenHash: sha256(String((sock.handshake.query as any)?.token ?? '')) },
      });
      if (team) {
        const others = await io.in(`team:${team.id}`).fetchSockets();
        if (others.length <= 1) {
          await prisma.team.update({ where: { id: team.id }, data: { online: false } });
          const game = await prisma.game.findUnique({ where: { id: team.gameId } });
          if (game) io.to(`host:${game.code}`).emit('team:presence', { teamId: team.id, name: team.name, online: false });
        }
      }
    });
  });

  async function sendState(sock: import('socket.io').Socket, code: string, token: string, sinceSeq: number) {
    const game = await prisma.game.findUnique({ where: { code } });
    if (!game) return;
    const hash = sha256(token);
    const isHost = game.hostTokenHash === hash;
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

    if (isHost) {
      const teams = (await prisma.team.findMany({ where: { gameId: game.id }, orderBy: { joinOrder: 'asc' } })).map(toTeamSummary);
      sock.emit('state:sync', { meta, teams, leaderboard: lb, activity, lastEventSeq: seq });
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

  // Time sync pulse every second.
  const timeTimer = setInterval(async () => {
    try {
      const games = await prisma.game.findMany();
      for (const game of games) {
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
    }
  }, 1000);

  process.on('beforeExit', () => clearInterval(timeTimer));

  const handle: SioHandle = {
    emitGameEvents(events: Array<{ type: string; t: number; questionCode?: string }>) {
      for (const e of events) {
        // Broadcast activity + leaderboard to all game rooms (host + teams + display)
        // Activity feed is pushed directly via event type.
        io.emit('game:event', e);
      }
    },
  };

  return { io, handle, timeTimer };
}

export type SocketServerHandle = ReturnType<typeof createSocketServer>;
/**
 * API smoke tests (Vitest + Supertest + socket.io-client) against a REAL
 * Postgres (wcc_test). Covers the happy-path surface of Phase 1:
 *   - health & public game creation
 *   - host/team auth guards (401/403) and join-existing
 *   - team state, display endpoints
 *   - purchases (idempotency, sold-conflict, ledger)
 *   - submissions (correct reward, wrong→FAILED, idempotency, attempt cap)
 *   - trades (propose→accept, ownership swap, coin pot)
 *   - Socket.IO sync (state:sync on connect, game:event, time:sync pulse)
 *
 * DB selection: tests/setup.ts points DATABASE_URL at TEST_DATABASE_URL
 * before this file is imported, so the app's Prisma singleton and the socket
 * server all hit wcc_test. The suite is fully isolated: tables are truncated
 * in beforeAll and every test mints its own game.
 */
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { io, type Socket } from 'socket.io-client';
import { PrismaClient } from '@prisma/client';
import { createApp, type AppBundle } from '../src/app';

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(TESTS_DIR, '..');
const TEST_URL = process.env.TEST_DATABASE_URL as string;

const TABLES = [
  'GameEvent',
  'Announcement',
  'AuditLog',
  'Transaction',
  'TradeItem',
  'Trade',
  'Submission',
  'QuestionOwnership',
  'Purchase',
  'Question',
  'TeamMember',
  'Team',
  'Game',
];

let bundle: AppBundle;
let httpServer: import('http').Server;
let baseUrl = '';
const admin = new PrismaClient();

const hostAuth = (token: string) => ({ Authorization: `Bearer ${token}` });
const idem = () => `smk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

async function createGame(title: string): Promise<{ gameCode: string; hostToken: string }> {
  const res = await request(bundle.app).post('/api/public/games').send({ title });
  expect(res.status).toBe(200);
  return res.body;
}

async function joinTeam(
  code: string,
  teamName: string,
  player1: string,
  player2?: string,
): Promise<{ teamId: string; teamName: string; teamAccessToken: string }> {
  const res = await request(bundle.app)
    .post(`/api/public/games/${code}/teams/join`)
    .send({ teamName, player1, ...(player2 ? { player2 } : {}) });
  expect(res.status).toBe(200);
  return res.body;
}

async function startGame(code: string, hostToken: string) {
  const res = await request(bundle.app).post('/api/host/start').set(hostAuth(hostToken));
  expect(res.status).toBe(200);
  return res.body as { game: { state: string } };
}

function question(code: string) {
  return {
    code,
    type: 'WILL_IT_COMPILE',
    difficulty: 'EASY',
    category: 'COMPILATION',
    title: `Smoke ${code}`,
    body: 'Will this compile?',
    codeSnippet: 'int main(void) { return 0; }',
    price: 100,
    reward: 200,
    hint: null,
    explanation: 'It is a valid C program.',
    answerData: { type: 'WILL_IT_COMPILE', matchMode: 'NORMALIZED', accepted: ['yes', 'it compiles'] },
  };
}

async function createQuestion(hostToken: string, q: object): Promise<{ id: string; code: string }> {
  const res = await request(bundle.app).post('/api/host/questions').set(hostAuth(hostToken)).send(q);
  expect(res.status).toBe(201);
  return res.body;
}

function teamSocket(code: string, token: string): Socket {
  return io(baseUrl, {
    query: { gameCode: code, token, role: 'team', lastSeq: '0' },
    transports: ['websocket'],
    forceNew: true,
  });
}

function once<T = unknown>(sock: Socket, event: string, timeoutMs = 6000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      sock.off(event);
      reject(new Error(`Timed out waiting for socket event "${event}"`));
    }, timeoutMs);
    sock.once(event, (data) => {
      clearTimeout(timer);
      resolve(data as T);
    });
    sock.once('connect_error', (err) => {
      clearTimeout(timer);
      reject(new Error(`socket connect_error: ${err.message}`));
    });
  });
}

beforeAll(async () => {
  // Bring the (separate) test DB up to date with migrations, idempotently.
  execSync('npx prisma migrate deploy', {
    cwd: SERVER_DIR,
    env: { ...process.env, DATABASE_URL: TEST_URL },
    stdio: 'pipe',
  });
  await admin.$executeRawUnsafe(`TRUNCATE ${TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`);

  bundle = createApp();
  httpServer = bundle.http;
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const { port } = httpServer.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
}, 90_000);

afterAll(async () => {
  if (bundle?.socket?.timeTimer) clearInterval(bundle.socket.timeTimer);
  if (bundle?.socket?.io) await new Promise<void>((resolve) => bundle.socket.io.close(() => resolve()));
  if (httpServer) await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  await admin.$disconnect();
});

// ─── Server + public API ─────────────────────────────────────────────────
describe('server & public API', () => {
  it('answers /api/health', async () => {
    const res = await request(bundle.app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('creates a game and resolves it by code', async () => {
    const g = await createGame('Health Game');
    const res = await request(bundle.app).get(`/api/public/games/${g.gameCode}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ code: g.gameCode, title: 'Health Game', state: 'LOBBY' });
  });

  it('returns 404 for an unknown game code', async () => {
    const res = await request(bundle.app).get('/api/public/games/ZZZZZZ');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

// ─── Auth guards ─────────────────────────────────────────────────────────
describe('auth guards', () => {
  let g: Awaited<ReturnType<typeof createGame>>;

  beforeAll(async () => {
    g = await createGame('Auth Game');
  });

  it('rejects a missing token', async () => {
    const res = await request(bundle.app).get('/api/host/state');
    expect(res.status).toBe(401);
  });

  it('rejects an invalid token', async () => {
    const res = await request(bundle.app).get('/api/host/state').set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).toBe(401);
  });

  it('accepts a valid host token', async () => {
    const res = await request(bundle.app).get('/api/host/state').set(hostAuth(g.hostToken));
    expect(res.status).toBe(200);
  });

  it('turns away a team token on a host route (403)', async () => {
    const t = await joinTeam(g.gameCode, 'Auth Team', 'Ada');
    const res = await request(bundle.app).get('/api/host/state').set(hostAuth(t.teamAccessToken));
    expect(res.status).toBe(403);
  });

  it('turns away a host token on a team route (403)', async () => {
    const res = await request(bundle.app).get('/api/team/state').set(hostAuth(g.hostToken));
    expect(res.status).toBe(403);
  });
});

// ─── Team identity & state ───────────────────────────────────────────────
describe('team identity & state', () => {
  let g: Awaited<ReturnType<typeof createGame>>;
  let t: Awaited<ReturnType<typeof joinTeam>>;

  beforeAll(async () => {
    g = await createGame('Team State');
    t = await joinTeam(g.gameCode, 'State Team', 'Ada', 'Grace');
  });

  it('join-existing resolves the same team from its access token', async () => {
    const res = await request(bundle.app)
      .post(`/api/public/games/${g.gameCode}/teams/join-existing`)
      .send({ teamAccessToken: t.teamAccessToken });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ teamId: t.teamId, teamName: 'State Team' });
  });

  it('join-existing returns 404 for a bogus token', async () => {
    const res = await request(bundle.app)
      .post(`/api/public/games/${g.gameCode}/teams/join-existing`)
      .send({ teamAccessToken: 'definitely-not-a-valid-token' });
    expect(res.status).toBe(404);
  });

  it('GET /api/team/state returns the full game payload', async () => {
    const res = await request(bundle.app).get('/api/team/state').set(hostAuth(t.teamAccessToken));
    expect(res.status).toBe(200);
    const body = res.body;
    expect(body.meta.code).toBe(g.gameCode);
    expect(body.meta.state).toBe('LOBBY');
    expect(body.team).toMatchObject({ id: t.teamId, name: 'State Team', coins: 1000 });
    expect(typeof body.lastEventSeq).toBe('number');
    for (const key of ['marketplace', 'inventory', 'transactions', 'leaderboard', 'activity']) {
      expect(Array.isArray(body[key])).toBe(true);
    }
  });

  it('GET /api/team/transactions shows the initial grant', async () => {
    const res = await request(bundle.app).get('/api/team/transactions').set(hostAuth(t.teamAccessToken));
    expect(res.status).toBe(200);
    const txn = res.body.find((x: { type: string }) => x.type === 'INITIAL');
    expect(txn).toBeDefined();
    expect(txn.amount).toBe(1000);
    expect(txn.balanceAfter).toBe(1000);
  });
});

// ─── Display endpoints ───────────────────────────────────────────────────
describe('display endpoints', () => {
  let g: Awaited<ReturnType<typeof createGame>>;

  beforeAll(async () => {
    g = await createGame('Display Game');
    await joinTeam(g.gameCode, 'Display Team', 'Ken');
    await startGame(g.gameCode, g.hostToken); // produces GAME_STARTED + MARKET_OPENED activity
  });

  it('returns meta + leaderboard + recentActivity', async () => {
    const res = await request(bundle.app).get(`/api/display/${g.gameCode}`);
    expect(res.status).toBe(200);
    expect(res.body.meta).toMatchObject({ code: g.gameCode, state: 'MARKET_OPEN' });
    expect(res.body.leaderboard).toHaveLength(1);
    expect(res.body.leaderboard[0]).toMatchObject({ teamName: 'Display Team', rank: 1 });
    expect(Array.isArray(res.body.recentActivity)).toBe(true);
  });

  it('returns a seq-paged event feed on /events', async () => {
    const res = await request(bundle.app).get(`/api/display/${g.gameCode}/events`);
    expect(res.status).toBe(200);
    expect(res.body.events.length).toBeGreaterThan(0);
    expect(res.body.seq).toBeGreaterThan(0);
    // Fetch from that exact seq returns no new events; seq is 0 when events is empty
    // because the endpoint returns `last ? Number(last.seq) : 0`.
    const res2 = await request(bundle.app).get(`/api/display/${g.gameCode}/events?sinceSeq=${res.body.seq}`);
    expect(res2.status).toBe(200);
    expect(res2.body.events).toEqual([]);
    expect(res2.body.seq).toBe(0);
  });

  it('returns 404 for an unknown display game', async () => {
    const res = await request(bundle.app).get('/api/display/NOPE99');
    expect(res.status).toBe(404);
  });
});

// ─── Marketplace & purchases ─────────────────────────────────────────────
describe('marketplace & purchases', () => {
  let g: Awaited<ReturnType<typeof createGame>>;
  let t: Awaited<ReturnType<typeof joinTeam>>;
  let qBuy: Awaited<ReturnType<typeof createQuestion>>;
  let qIdem: Awaited<ReturnType<typeof createQuestion>>;
  let qConflict: Awaited<ReturnType<typeof createQuestion>>;

  beforeAll(async () => {
    g = await createGame('Market Game');
    t = await joinTeam(g.gameCode, 'Buyer', 'Ada');
    qBuy = await createQuestion(g.hostToken, question('MKT01'));
    qIdem = await createQuestion(g.hostToken, question('MKT02'));
    qConflict = await createQuestion(g.hostToken, question('MKT03'));
    await startGame(g.gameCode, g.hostToken);
  });

  it('markets the questions to the team without leaking the answer', async () => {
    const res = await request(bundle.app).get('/api/team/marketplace').set(hostAuth(t.teamAccessToken));
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(3);
    const item = res.body.find((x: { id: string }) => x.id === qBuy.id);
    expect(item).toBeDefined();
    expect(item.purchasedByMe).toBe(false);
    expect(item.answerData).toBeUndefined();
  });

  it('purchases a question and debits coins', async () => {
    const res = await request(bundle.app)
      .post(`/api/team/questions/${qBuy.id}/purchase`)
      .set(hostAuth(t.teamAccessToken))
      .send({ idempotencyKey: idem() });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, already: false, questionCode: 'MKT01', balanceAfter: 900 });
  });

  it('replays an idempotent purchase as a no-op', async () => {
    const k = idem();
    const first = await request(bundle.app)
      .post(`/api/team/questions/${qIdem.id}/purchase`)
      .set(hostAuth(t.teamAccessToken))
      .send({ idempotencyKey: k });
    expect(first.status).toBe(200);
    expect(first.body.ok).toBe(true);

    const second = await request(bundle.app)
      .post(`/api/team/questions/${qIdem.id}/purchase`)
      .set(hostAuth(t.teamAccessToken))
      .send({ idempotencyKey: k });
    expect(second.status).toBe(200);
    expect(second.body.already).toBe(true);
  });

  it('refuses a second buyer (question already sold → 409 CONFLICT)', async () => {
    const res1 = await request(bundle.app)
      .post(`/api/team/questions/${qConflict.id}/purchase`)
      .set(hostAuth(t.teamAccessToken))
      .send({ idempotencyKey: idem() });
    expect(res1.status).toBe(200);

    const res2 = await request(bundle.app)
      .post(`/api/team/questions/${qConflict.id}/purchase`)
      .set(hostAuth(t.teamAccessToken))
      .send({ idempotencyKey: idem() });
    expect(res2.status).toBe(409);
    expect(res2.body.error.code).toBe('CONFLICT');
  });

  it('tracks the purchases in inventory and ledger', async () => {
    const inv = await request(bundle.app).get('/api/team/inventory').set(hostAuth(t.teamAccessToken));
    expect(inv.status).toBe(200);
    // Two purchases should be in inventory (MKT01 + MKT02 + MKT03 = 3)
    expect(inv.body.length).toBe(3);
    for (const q of [qBuy, qIdem, qConflict]) {
      const owned = inv.body.find((x: { question: { id: string } }) => x.question.id === q.id);
      expect(owned).toBeDefined();
      expect(owned).toMatchObject({ status: 'UNSOLVED', attemptsUsed: 0, maxAttempts: 1 });
    }

    const txns = await request(bundle.app).get('/api/team/transactions').set(hostAuth(t.teamAccessToken));
    const purchases = txns.body.filter((x: { type: string }) => x.type === 'PURCHASE');
    expect(purchases.length).toBe(3);
    // BalanceAfter values should be 900, 800, 700 (DESC createdAt → newest first)
    const balances = purchases.map((p: { balanceAfter: number }) => p.balanceAfter).sort((a: number, b: number) => a - b);
    expect(balances).toEqual([700, 800, 900]);
  });
});

// ─── Submissions ─────────────────────────────────────────────────────────
describe('submissions & grading', () => {
  let g: Awaited<ReturnType<typeof createGame>>;
  let t: Awaited<ReturnType<typeof joinTeam>>;
  let qa: Awaited<ReturnType<typeof createQuestion>>;
  let qb: Awaited<ReturnType<typeof createQuestion>>;

  beforeAll(async () => {
    g = await createGame('Solve Game');
    t = await joinTeam(g.gameCode, 'Solver', 'Ada');
    qa = await createQuestion(g.hostToken, question('SOL01'));
    qb = await createQuestion(g.hostToken, question('SOL02'));
    await startGame(g.gameCode, g.hostToken);
    // Buy both questions so we can exercise correct + wrong paths.
    for (const q of [qa, qb]) {
      const res = await request(bundle.app)
        .post(`/api/team/questions/${q.id}/purchase`)
        .set(hostAuth(t.teamAccessToken))
        .send({ idempotencyKey: idem() });
      expect(res.status).toBe(200);
    }
  });

  it('grants the reward for a correct answer and marks SOLVED', async () => {
    const res = await request(bundle.app)
      .post(`/api/team/questions/${qa.id}/submit`)
      .set(hostAuth(t.teamAccessToken))
      .send({ idempotencyKey: idem(), answer: { kind: 'free', text: 'Yes' } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ correct: true, already: false, coinsAwarded: 200 });

    const inv = await request(bundle.app).get('/api/team/inventory').set(hostAuth(t.teamAccessToken));
    const owned = inv.body.find((x: { question: { id: string } }) => x.question.id === qa.id);
    expect(owned.status).toBe('SOLVED');
  });

  it('replays an idempotent submission without double-awarding', async () => {
    const k = idem();
    const first = await request(bundle.app)
      .post(`/api/team/questions/${qb.id}/submit`)
      .set(hostAuth(t.teamAccessToken))
      .send({ idempotencyKey: k, answer: { kind: 'free', text: 'it compiles' } });
    expect(first.body).toMatchObject({ correct: true, already: false, coinsAwarded: 200 });

    const second = await request(bundle.app)
      .post(`/api/team/questions/${qb.id}/submit`)
      .set(hostAuth(t.teamAccessToken))
      .send({ idempotencyKey: k, answer: { kind: 'free', text: 'nope!!' } });
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ correct: true, already: true, coinsAwarded: 200 });
  });

  it('cannot re-submit a solved question (409 CONFLICT)', async () => {
    const res = await request(bundle.app)
      .post(`/api/team/questions/${qa.id}/submit`)
      .set(hostAuth(t.teamAccessToken))
      .send({ idempotencyKey: idem(), answer: { kind: 'free', text: 'yes' } });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('marks a wrong answer FAILED and then blocks further attempts', async () => {
    let res: { status: number; body: { correct?: boolean } };
    // Wrong-answer path needs a brand-new question (maxAttempts=1, failMarksSolved=true).
    const qc = await createQuestion(g.hostToken, { ...question('SOL03'), answerData: { type: 'WILL_IT_COMPILE', matchMode: 'NORMALIZED', accepted: ['yes'] } });
    res = await request(bundle.app).post(`/api/team/questions/${qc.id}/purchase`).set(hostAuth(t.teamAccessToken)).send({ idempotencyKey: idem() });
    expect(res.status).toBe(200);

    const wrong = await request(bundle.app)
      .post(`/api/team/questions/${qc.id}/submit`)
      .set(hostAuth(t.teamAccessToken))
      .send({ idempotencyKey: idem(), answer: { kind: 'free', text: 'no' } });
    expect(wrong.status).toBe(200);
    expect(wrong.body).toMatchObject({ correct: false, already: false, coinsAwarded: 0 });

    const inv = await request(bundle.app).get('/api/team/inventory').set(hostAuth(t.teamAccessToken));
    const owned = inv.body.find((x: { question: { id: string } }) => x.question.id === qc.id);
    expect(owned.status).toBe('FAILED');

    const again = await request(bundle.app)
      .post(`/api/team/questions/${qc.id}/submit`)
      .set(hostAuth(t.teamAccessToken))
      .send({ idempotencyKey: idem(), answer: { kind: 'free', text: 'yes' } });
    expect(again.status).toBe(409);
  });
});

// ─── Trades ──────────────────────────────────────────────────────────────
describe('trades', () => {
  let g: Awaited<ReturnType<typeof createGame>>;
  let a: Awaited<ReturnType<typeof joinTeam>>;
  let b: Awaited<ReturnType<typeof joinTeam>>;
  let qA: Awaited<ReturnType<typeof createQuestion>>;
  let qB: Awaited<ReturnType<typeof createQuestion>>;

  beforeAll(async () => {
    g = await createGame('Trade Game');
    a = await joinTeam(g.gameCode, 'Team Alpha', 'Ada');
    b = await joinTeam(g.gameCode, 'Team Beta', 'Lin');
    qA = await createQuestion(g.hostToken, question('TRD01'));
    qB = await createQuestion(g.hostToken, question('TRD02'));
    await startGame(g.gameCode, g.hostToken);
    // Alpha buys TRD01, Beta buys TRD02.
    const pa = await request(bundle.app).post(`/api/team/questions/${qA.id}/purchase`).set(hostAuth(a.teamAccessToken)).send({ idempotencyKey: idem() });
    expect(pa.status).toBe(200);
    const pb = await request(bundle.app).post(`/api/team/questions/${qB.id}/purchase`).set(hostAuth(b.teamAccessToken)).send({ idempotencyKey: idem() });
    expect(pb.status).toBe(200);
  });

  it('proposes a trade and the receiver accepts, swapping ownership and coins', async () => {
    const propose = await request(bundle.app)
      .post('/api/team/trades')
      .set(hostAuth(a.teamAccessToken))
      .send({
        targetTeamId: b.teamId,
        offeredQuestionId: qA.id,
        requestedQuestionId: qB.id,
        coins: 50,
        idempotencyKey: idem(),
      });
    expect(propose.status).toBe(200);
    expect(propose.body.already).toBe(false);
    const tradeId = propose.body.tradeId as string;

    const accept = await request(bundle.app)
      .post(`/api/team/trades/${tradeId}/accept`)
      .set(hostAuth(b.teamAccessToken))
      .send({ idempotencyKey: idem() });
    expect(accept.status).toBe(200);
    expect(accept.body.trade.state).toBe('EXECUTED');

    // Ownership swapped: Alpha now holds TRD02, Beta holds TRD01.
    const invA = await request(bundle.app).get('/api/team/inventory').set(hostAuth(a.teamAccessToken));
    const invB = await request(bundle.app).get('/api/team/inventory').set(hostAuth(b.teamAccessToken));
    expect(invA.body.map((x: { question: { code: string } }) => x.question.code)).toContain('TRD02');
    expect(invB.body.map((x: { question: { code: string } }) => x.question.code)).toContain('TRD01');

    // Coin pot moved: 1000 - 100 purchase + (-50 out) = 850; Beta = 950.
    const stA = await request(bundle.app).get('/api/team/state').set(hostAuth(a.teamAccessToken));
    const stB = await request(bundle.app).get('/api/team/state').set(hostAuth(b.teamAccessToken));
    expect(stA.body.team.coins).toBe(850);
    expect(stB.body.team.coins).toBe(950);
  });

  it('rejects a trade when the target refuses (406-free: it is a reject, not accept)', async () => {
    // Single offer from Alpha -> Beta, then Beta rejects it.
    const propose = await request(bundle.app)
      .post('/api/team/trades')
      .set(hostAuth(a.teamAccessToken))
      .send({
        targetTeamId: b.teamId,
        offeredQuestionId: qB.id, // Beta owns TRD01 now after accept above
        requestedQuestionId: qA.id, // Alpha owns TRD02 now
        coins: 0,
        idempotencyKey: idem(),
      });
    expect(propose.status).toBe(200);
    const tradeId = propose.body.tradeId as string;

    const reject = await request(bundle.app)
      .post(`/api/team/trades/${tradeId}/reject`)
      .set(hostAuth(b.teamAccessToken))
      .send({ idempotencyKey: idem() });
    expect(reject.status).toBe(200);
    expect(reject.body.ok).toBe(true);
  });
});

// ─── Socket.IO sync ──────────────────────────────────────────────────────
describe('socket.io sync', () => {
  let g: Awaited<ReturnType<typeof createGame>>;
  let t: Awaited<ReturnType<typeof joinTeam>>;

  beforeAll(async () => {
    g = await createGame('Socket Game');
    t = await joinTeam(g.gameCode, 'Socket Team', 'Ada');
    await createQuestion(g.hostToken, question('SCK01'));
    await startGame(g.gameCode, g.hostToken);
  });

  it('delivers state:sync on connect (reconnect resync)', async () => {
    const sock = teamSocket(g.gameCode, t.teamAccessToken);
    const sync = await once<{
      meta: { code: string };
      team: { name: string };
      marketplace: unknown[];
      lastEventSeq: number;
    }>(sock, 'state:sync');
    expect(sync.meta.code).toBe(g.gameCode);
    expect(sync.team.name).toBe('Socket Team');
    expect(sync.marketplace.length).toBe(1);
    expect(sync.lastEventSeq).toBeGreaterThan(0);
    sock.disconnect();
  });

  it('pushes game:event live after a host action', async () => {
    const sock = teamSocket(g.gameCode, t.teamAccessToken);
    await once(sock, 'state:sync'); // wait for auth + room join
    const ev = once<{ type: string; message?: string }>(sock, 'game:event');
    const ann = await request(bundle.app)
      .post('/api/host/announcements')
      .set(hostAuth(g.hostToken))
      .send({ message: 'Heads up, teams!' });
    expect(ann.status).toBe(200);
    const event = await ev;
    expect(event.type).toBe('ANNOUNCEMENT_CREATED');
    sock.disconnect();
  });

  it('emits a time:sync pulse once the game has a clock', async () => {
    const sock = teamSocket(g.gameCode, t.teamAccessToken);
    const sync = await once<{ remainingMs: number; state: string }>(sock, 'time:sync');
    expect(sync.remainingMs).toBeGreaterThan(0);
    expect(['MARKET_OPEN', 'FINAL_MINUTE']).toContain(sync.state);
    sock.disconnect();
  });
});
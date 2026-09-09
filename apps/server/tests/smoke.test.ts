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
 *   - full phase lifecycle (FINAL_MINUTE/FINAL_SCORING/COMPLETED, idempotence,
 *     restart persistence) and concurrency (sole-winner purchase / trade)
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

function hostSocket(code: string, token: string): Socket {
  return io(baseUrl, {
    query: { gameCode: code, token, role: 'host', lastSeq: '0' },
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
  // Stop the auto 1s timer: the suite drives phase transitions deterministically
  // via explicit timestamps + one-off packet.runPulse() calls, so a live tick
  // would race those assertions (the timer could transition a game between a
  // test's endTime update and its own advance call).
  if (bundle.socket.timeTimer) clearInterval(bundle.socket.timeTimer);
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
    await once(sock, 'state:sync'); // ensure the socket is authenticated and in the room
    const syncP = once<{ remainingMs: number; state: string }>(sock, 'time:sync');
    await bundle.socket.runPulse(); // drive one deterministic pulse (auto timer is stopped)
    const sync = await syncP;
    expect(sync.remainingMs).toBeGreaterThan(0);
    expect(['MARKET_OPEN', 'FINAL_MINUTE']).toContain(sync.state);
    sock.disconnect();
  });

  it('connects a public display socket without a token and receives PublicDisplayState', async () => {
    const sock = io(baseUrl, {
      query: { gameCode: g.gameCode, role: 'display', lastSeq: '0' },
      transports: ['websocket'],
      forceNew: true,
    });
    const sync = await once<{
      meta: { code: string };
      leaderboard: unknown[];
      recentActivity: unknown[];
      lastEventSeq: number;
    }>(sock, 'state:sync');
    expect(sync.meta.code).toBe(g.gameCode);
    expect(Array.isArray(sync.leaderboard)).toBe(true);
    expect(Array.isArray(sync.recentActivity)).toBe(true);
    expect(typeof sync.lastEventSeq).toBe('number');
    sock.disconnect();
  });

  it('rejects a display socket for an unknown game code', async () => {
    const sock = io(baseUrl, {
      query: { gameCode: 'NOPE00', role: 'display', lastSeq: '0' },
      transports: ['websocket'],
      forceNew: true,
    });
    const err = await once<{ code: string }>(sock, 'error');
    expect(err.code).toBe('NOT_FOUND');
    sock.disconnect();
  });

  it('broadcasts team:presence to teammates with a live connected seat count', async () => {
    const sockA = teamSocket(g.gameCode, t.teamAccessToken);
    await once(sockA, 'state:sync');

    // Second teammate (same shared token) connects → A sees connectedCount 2.
    const presenceP = once<{ teamId: string; online: boolean; connectedCount: number }>(sockA, 'team:presence');
    const sockB = teamSocket(g.gameCode, t.teamAccessToken);
    await once(sockB, 'state:sync');
    const evt = await presenceP;
    expect(evt).toMatchObject({ teamId: t.teamId, online: true, connectedCount: 2 });

    // B drops → A sees connectedCount 1 but the team stays online.
    const afterDrop = once<{ online: boolean; connectedCount: number }>(sockA, 'team:presence');
    sockB.disconnect();
    const drop = await afterDrop;
    expect(drop).toMatchObject({ online: true, connectedCount: 1 });

    // Last socket drops → persisted presence flips offline.
    sockA.disconnect();
    await new Promise((r) => setTimeout(r, 80));
    const row = await admin.team.findUnique({ where: { id: t.teamId } });
    expect(row!.online).toBe(false);
    expect(row!.disconnectedAt).not.toBeNull();
  });
});

// ─── Phase transitions & concurrency ────────────────────────────────────
describe('phase transitions & concurrency', () => {
  let g: Awaited<ReturnType<typeof createGame>>;
  let t: Awaited<ReturnType<typeof joinTeam>>;
  let qBuy: Awaited<ReturnType<typeof createQuestion>>;

  beforeAll(async () => {
    g = await createGame('Phase Game');
    t = await joinTeam(g.gameCode, 'Phase Team', 'Ada');
    qBuy = await createQuestion(g.hostToken, question('PHS01'));
    await startGame(g.gameCode, g.hostToken);
  });

  it('Test A — auto market close transitions to MARKET_CLOSED when time passes', async () => {
    const game = await admin.game.findUnique({ where: { code: g.gameCode } });
    await admin.game.update({
      where: { id: game!.id },
      data: { endTime: new Date(Date.now() - 5_000) }, // 5s ago
    });
    const { advancePhaseIfNeeded } = await import('../src/domain/games');
    const { prisma } = await import('../src/lib/prisma');
    const events = await advancePhaseIfNeeded(prisma, game!.id, new Date());
    expect(events.some((e: any) => e.type === 'MARKET_CLOSED')).toBe(true);

    const state = await request(bundle.app).get(`/api/public/games/${g.gameCode}`);
    expect(state.body.state).toBe('MARKET_CLOSED');
  });

  it('Test B — repeated advancePhaseIfNeeded calls are idempotent (no duplicate events)', async () => {
    const { advancePhaseIfNeeded } = await import('../src/domain/games');
    const { prisma } = await import('../src/lib/prisma');
    const game = await admin.game.findUnique({ where: { code: g.gameCode } });

    const events1 = await advancePhaseIfNeeded(prisma, game!.id, new Date());
    const events2 = await advancePhaseIfNeeded(prisma, game!.id, new Date());
    const events3 = await advancePhaseIfNeeded(prisma, game!.id, new Date());

    expect(events1.length).toBe(0);
    expect(events2.length).toBe(0);
    expect(events3.length).toBe(0);

    const geCount = await admin.gameEvent.count({ where: { gameId: game!.id } });
    const geCount2 = await admin.gameEvent.count({ where: { gameId: game!.id } });
    expect(geCount).toBe(geCount2);
  });
});

describe('full phase lifecycle (FINAL_MINUTE → FINAL_SCORING → COMPLETED)', () => {
  it('Test I — MARKET_OPEN → FINAL_MINUTE exactly once when ≤60s remain', async () => {
    const g = await createGame('Lifecycle Final Minute');
    await joinTeam(g.gameCode, 'Alpha', 'Ada');
    await startGame(g.gameCode, g.hostToken);
    const game = await admin.game.findUnique({ where: { code: g.gameCode } });
    const { advancePhaseIfNeeded } = await import('../src/domain/games');
    const { prisma } = await import('../src/lib/prisma');

    // Clock inside the final-minute window but before the deadline (endTime 30s out):
    // the pulse must move MARKET_OPEN → FINAL_MINUTE and must NOT close the market.
    await admin.game.update({ where: { id: game!.id }, data: { endTime: new Date(Date.now() + 30_000) } });

    await advancePhaseIfNeeded(prisma, game!.id, new Date());

    let fresh = await admin.game.findUnique({ where: { id: game!.id } });
    expect(fresh!.state).toBe('FINAL_MINUTE');
    const finalMinuteEvents = await admin.gameEvent.count({ where: { gameId: game!.id, type: 'FINAL_MINUTE' } });
    const marketClosedEvents = await admin.gameEvent.count({ where: { gameId: game!.id, type: 'MARKET_CLOSED' } });
    expect(finalMinuteEvents).toBe(1);
    expect(marketClosedEvents).toBe(0);

    // Idempotent: further pulses emit nothing new and leave the state untouched.
    const events2 = await advancePhaseIfNeeded(prisma, game!.id, new Date());
    expect(events2).toHaveLength(0);
    fresh = await admin.game.findUnique({ where: { id: game!.id } });
    expect(fresh!.state).toBe('FINAL_MINUTE');
  });

  it('Test J — MARKET_CLOSED → FINAL_SCORING → COMPLETED with a single, idempotent recompute', async () => {
    const g = await createGame('Lifecycle Scoring');
    await joinTeam(g.gameCode, 'Alpha', 'Ada');
    await startGame(g.gameCode, g.hostToken);
    const { advancePhaseIfNeeded } = await import('../src/domain/games');
    const { prisma } = await import('../src/lib/prisma');
    let game = await admin.game.findUnique({ where: { code: g.gameCode } });

    const endTime = new Date(Date.now() - 5_000); // deadline already passed
    await admin.game.update({ where: { id: game!.id }, data: { endTime } });
    await advancePhaseIfNeeded(prisma, game!.id, new Date());
    game = await admin.game.findUnique({ where: { id: game!.id } });
    expect(game!.state).toBe('MARKET_CLOSED');

    // NOTE: the MARKET_CLOSED claim rewrites endTime to the pulse time (now), so the
    // scoring window is measured from the *persisted* end-of-market, not our original
    // endTime. Re-read it so the boundaries are deterministic.
    const closedAt = game!.endTime!.getTime();

    // FINAL_SCORING fires only once the configured delay (10s) has elapsed. The live
    // 1s timer clock is nowhere near it yet, so an explicit pulse at closed+delay+1s
    // is the sole driver — no race.
    const scoringAt = new Date(closedAt + 10_000 + 1_000);
    await advancePhaseIfNeeded(prisma, game!.id, scoringAt);
    game = await admin.game.findUnique({ where: { id: game!.id } });
    expect(game!.state).toBe('FINAL_SCORING');
    expect(await admin.gameEvent.count({ where: { gameId: game!.id, type: 'FINAL_SCORING' } })).toBe(1);

    // COMPLETED fires after the scoring window (5s) and recomputes every score.
    const completeAt = new Date(closedAt + 10_000 + 5_000 + 1_000);
    await advancePhaseIfNeeded(prisma, game!.id, completeAt);
    game = await admin.game.findUnique({ where: { id: game!.id } });
    expect(game!.state).toBe('COMPLETED');
    expect(await admin.gameEvent.count({ where: { gameId: game!.id, type: 'GAME_COMPLETED' } })).toBe(1);

    // Idempotent at the terminal state too.
    const late = await advancePhaseIfNeeded(prisma, game!.id, completeAt);
    expect(late).toHaveLength(0);
    expect(await admin.gameEvent.count({ where: { gameId: game!.id, type: 'GAME_COMPLETED' } })).toBe(1);
  });

  it('Test K — phase survives a server restart: derived purely from persisted timestamps', async () => {
    const g = await createGame('Lifecycle Restart');
    await joinTeam(g.gameCode, 'Alpha', 'Ada');
    await startGame(g.gameCode, g.hostToken);
    const { effectiveState } = await import('@wcc/shared');
    const game = await admin.game.findUnique({ where: { code: g.gameCode } });

    await admin.game.update({ where: { id: game!.id }, data: { endTime: new Date(Date.now() - 5_000) } });

    // A restarted process has no in-memory state: it re-reads the row and derives the
    // phase from stored timestamps. The persisted row alone must yield MARKET_CLOSED —
    // proving a restart cannot lose or reset the authoritative clock.
    const row = await admin.game.findUnique({ where: { id: game!.id } });
    expect(
      effectiveState(
        { state: row!.state, pausedAt: row!.pausedAt, startTime: row!.startTime, endTime: row!.endTime },
        new Date(),
      ),
    ).toBe('MARKET_CLOSED');

    // And the restarted server's first timer pulse catches the row up to the persisted
    // boundary so the stored state agrees with what clients already saw.
    const { advancePhaseIfNeeded } = await import('../src/domain/games');
    const { prisma } = await import('../src/lib/prisma');
    await advancePhaseIfNeeded(prisma, game!.id, new Date());
    const after = await admin.game.findUnique({ where: { id: game!.id } });
    expect(after!.state).toBe('MARKET_CLOSED');
  });
});

describe('trade expiration', () => {
  let g: Awaited<ReturnType<typeof createGame>>;
  let a: Awaited<ReturnType<typeof joinTeam>>;
  let b: Awaited<ReturnType<typeof joinTeam>>;
  let qA: Awaited<ReturnType<typeof createQuestion>>;
  let qB: Awaited<ReturnType<typeof createQuestion>>;

  beforeAll(async () => {
    g = await createGame('Trade Expire');
    a = await joinTeam(g.gameCode, 'Alpha', 'Ada');
    b = await joinTeam(g.gameCode, 'Beta', 'Lin');
    qA = await createQuestion(g.hostToken, question('EXP01'));
    qB = await createQuestion(g.hostToken, question('EXP02'));
    await startGame(g.gameCode, g.hostToken);
    await request(bundle.app).post(`/api/team/questions/${qA.id}/purchase`).set(hostAuth(a.teamAccessToken)).send({ idempotencyKey: idem() });
    await request(bundle.app).post(`/api/team/questions/${qB.id}/purchase`).set(hostAuth(b.teamAccessToken)).send({ idempotencyKey: idem() });
  });

  it('Test C — stale trade expiration marks trade EXPIRED and releases tradeLock', async () => {
    const propose = await request(bundle.app).post('/api/team/trades').set(hostAuth(a.teamAccessToken)).send({
      targetTeamId: b.teamId,
      offeredQuestionId: qA.id,
      requestedQuestionId: qB.id,
      coins: 0,
      idempotencyKey: idem(),
    });
    expect(propose.status).toBe(200);
    const tradeId = propose.body.tradeId as string;

    await admin.trade.update({ where: { id: tradeId }, data: { expiresAt: new Date(Date.now() - 1_000) } });

    const { expireStaleTrades } = await import('../src/domain/trades');
    const { prisma } = await import('../src/lib/prisma');
    const expireGame = await admin.game.findUnique({ where: { code: g.gameCode } });
    if (!expireGame) throw new Error('game not found for trade expiry');
    const events = await expireStaleTrades(prisma, expireGame);
    expect(events.some((e: any) => e.type === 'TRADE_EXPIRED')).toBe(true);

    const t2 = await admin.trade.findUnique({ where: { id: tradeId } });
    expect(t2!.state).toBe('EXPIRED');

    const o1 = await admin.questionOwnership.findUnique({ where: { questionId: qA.id } });
    const o2 = await admin.questionOwnership.findUnique({ where: { questionId: qB.id } });
    expect(o1!.tradeLock).toBe(false);
    expect(o2!.tradeLock).toBe(false);
  });

  it('Test D — accepting an expired trade is rejected with CONFLICT', async () => {
    // Use FRESH questions that haven't been swapped by Test C
    const qA2 = await createQuestion(g.hostToken, question('EXP03'));
    const qB2 = await createQuestion(g.hostToken, question('EXP04'));
    await request(bundle.app).post(`/api/team/questions/${qA2.id}/purchase`).set(hostAuth(a.teamAccessToken)).send({ idempotencyKey: idem() });
    await request(bundle.app).post(`/api/team/questions/${qB2.id}/purchase`).set(hostAuth(b.teamAccessToken)).send({ idempotencyKey: idem() });

    const propose = await request(bundle.app).post('/api/team/trades').set(hostAuth(a.teamAccessToken)).send({
      targetTeamId: b.teamId,
      offeredQuestionId: qA2.id,   // Alpha owns qA2
      requestedQuestionId: qB2.id, // Alpha wants qB2
      coins: 0,
      idempotencyKey: idem(),
    });
    expect(propose.status).toBe(200);
    const tradeId = propose.body.tradeId as string;

    await admin.trade.update({ where: { id: tradeId }, data: { expiresAt: new Date(Date.now() - 1_000) } });

    const accept = await request(bundle.app)
      .post(`/api/team/trades/${tradeId}/accept`)
      .set(hostAuth(b.teamAccessToken))
      .send({ idempotencyKey: idem() });
    expect(accept.status).toBe(409);
    expect(accept.body.error.code).toBe('CONFLICT');
  });
});

describe('phase broadcast events', () => {
  let g: Awaited<ReturnType<typeof createGame>>;
  let t: Awaited<ReturnType<typeof joinTeam>>;

  beforeAll(async () => {
    g = await createGame('Phase Broadcast');
    t = await joinTeam(g.gameCode, 'Broadcaster', 'Ada');
    await startGame(g.gameCode, g.hostToken);
  });

  it('Test G — MARKET_CLOSED event is emitted exactly once on phase change', async () => {
    const game = await admin.game.findUnique({ where: { code: g.gameCode } });
    await admin.game.update({ where: { id: game!.id }, data: { endTime: new Date(Date.now() - 5_000) } });

    const sock = io(baseUrl, {
      query: { gameCode: g.gameCode, token: t.teamAccessToken, role: 'team', lastSeq: '0' },
      transports: ['websocket'],
      forceNew: true,
    });
    const events: any[] = [];
    sock.on('game:event', (e) => events.push(e));
    await once(sock, 'state:sync'); // auth + room join complete — then drive one pulse

    // One deterministic pulse performs the MARKET_CLOSED transition AND broadcasts
    // it (the auto 1s timer is stopped, so nothing else can transition or emit).
    await bundle.socket.runPulse();
    await new Promise((r) => setTimeout(r, 120));
    sock.disconnect();

    const closed = events.filter((e) => e.type === 'MARKET_CLOSED');
    expect(closed.length).toBe(1);
  });
});

describe('reconnect around phase boundary', () => {
  let g: Awaited<ReturnType<typeof createGame>>;
  let t: Awaited<ReturnType<typeof joinTeam>>;

  beforeAll(async () => {
    g = await createGame('Reconnect Phase');
    t = await joinTeam(g.gameCode, 'Reconnector', 'Ada');
    await startGame(g.gameCode, g.hostToken);
  });

  it('Test H — client reconnecting after phase change sees correct authoritative state', async () => {
    const { advancePhaseIfNeeded } = await import('../src/domain/games');
    const { prisma } = await import('../src/lib/prisma');
    const game = await admin.game.findUnique({ where: { code: g.gameCode } });

    await admin.game.update({ where: { id: game!.id }, data: { endTime: new Date(Date.now() - 5_000) } });
    await advancePhaseIfNeeded(prisma, game!.id, new Date());

    const sock = io(baseUrl, {
      query: { gameCode: g.gameCode, token: t.teamAccessToken, role: 'team', lastSeq: '0' },
      transports: ['websocket'],
      forceNew: true,
    });
    const sync = await new Promise<any>((resolve) => {
      sock.once('state:sync', resolve);
    });
    sock.disconnect();

    expect(sync.meta.state).toBe('MARKET_CLOSED');
    expect(sync.meta.phase.marketOpen).toBe(false);
  });
});

// ─── Concurrency stress tests (40-team simulation) ──────────────────────
describe('concurrency: simultaneous purchase (10 teams)', () => {
  let g: Awaited<ReturnType<typeof createGame>>;
  let teams: Awaited<ReturnType<typeof joinTeam>>[];
  let q: Awaited<ReturnType<typeof createQuestion>>;

  beforeAll(async () => {
    g = await createGame('Concurrency 10');
    teams = [];
    for (let i = 0; i < 10; i++) {
      teams.push(await joinTeam(g.gameCode, `Team${i}`, `P${i}a`, `P${i}b`));
    }
    q = await createQuestion(g.hostToken, question('CONC01'));
    await startGame(g.gameCode, g.hostToken);
  });

  it('Test E — exactly one team purchases the single available question', async () => {
    const attempts = teams.map((team) =>
      request(bundle.app)
        .post(`/api/team/questions/${q.id}/purchase`)
        .set(hostAuth(team.teamAccessToken))
        .send({ idempotencyKey: idem() })
    );
    const results = await Promise.all(attempts);

    const successful = results.filter((r) => r.status === 200 && r.body.ok && !r.body.already);

    // The critical correctness property: exactly one team owns the question
    expect(successful.length).toBe(1);

    const ownerships = await admin.questionOwnership.findMany({ where: { questionId: q.id } });
    expect(ownerships.length).toBe(1);
    const winner = await admin.team.findUnique({ where: { id: ownerships[0]!.teamId } });
    // question() helper charges price 100, so the winner pays exactly 100 → 900 coins.
    expect(winner!.coins).toBeLessThanOrEqual(900);
    expect(winner!.coins).toBeGreaterThanOrEqual(800);
  });
});

describe('concurrency: simultaneous trade acceptance', () => {
  let g: Awaited<ReturnType<typeof createGame>>;
  let a: Awaited<ReturnType<typeof joinTeam>>;
  let b: Awaited<ReturnType<typeof joinTeam>>;
  let c: Awaited<ReturnType<typeof joinTeam>>;
  let qA: Awaited<ReturnType<typeof createQuestion>>;
  let qB: Awaited<ReturnType<typeof createQuestion>>;

  beforeAll(async () => {
    g = await createGame('Concurrent Trade');
    a = await joinTeam(g.gameCode, 'Alpha', 'Ada');
    b = await joinTeam(g.gameCode, 'Beta', 'Lin');
    c = await joinTeam(g.gameCode, 'Gamma', 'Ken');
    qA = await createQuestion(g.hostToken, question('CTD01'));
    qB = await createQuestion(g.hostToken, question('CTD02'));
    await startGame(g.gameCode, g.hostToken);
    await request(bundle.app).post(`/api/team/questions/${qA.id}/purchase`).set(hostAuth(a.teamAccessToken)).send({ idempotencyKey: idem() });
    await request(bundle.app).post(`/api/team/questions/${qB.id}/purchase`).set(hostAuth(b.teamAccessToken)).send({ idempotencyKey: idem() });
  });

  it('Test F — only one accept succeeds when two teams race to accept the same trade', async () => {
    const propose = await request(bundle.app).post('/api/team/trades').set(hostAuth(a.teamAccessToken)).send({
      targetTeamId: b.teamId,
      offeredQuestionId: qA.id,
      requestedQuestionId: qB.id,
      coins: 50,
      idempotencyKey: idem(),
    });
    expect(propose.status).toBe(200);
    const tradeId = propose.body.tradeId as string;

    const acceptBeta = request(bundle.app)
      .post(`/api/team/trades/${tradeId}/accept`)
      .set(hostAuth(b.teamAccessToken))
      .send({ idempotencyKey: idem() });
    const acceptBeta2 = request(bundle.app)
      .post(`/api/team/trades/${tradeId}/accept`)
      .set(hostAuth(b.teamAccessToken))
      .send({ idempotencyKey: idem() });

    const [r1, r2] = await Promise.all([acceptBeta, acceptBeta2]);

    const successful = [r1, r2].filter((r) => r.status === 200);
    const conflicts = [r1, r2].filter((r) => r.status === 409 && r.body.error.code === 'TRADE_STATE');

    expect(successful.length).toBe(1);
    expect(conflicts.length).toBe(1);

    const trade = await admin.trade.findUnique({ where: { id: tradeId } });
    expect(trade!.state).toBe('EXECUTED');

    // Ownership integrity: exactly one owner per question, swapped exactly once,
    // no question duplicated and no residual tradeLock on either.
    const ownA = await admin.questionOwnership.findUnique({ where: { questionId: qA.id } });
    const ownB = await admin.questionOwnership.findUnique({ where: { questionId: qB.id } });
    expect(ownA!.teamId).toBe(b.teamId); // offered qA moved to Beta
    expect(ownB!.teamId).toBe(a.teamId); // requested qB moved to Alpha
    expect(ownA!.tradeLock).toBe(false);
    expect(ownB!.tradeLock).toBe(false);
    const ownersOfA = await admin.questionOwnership.count({ where: { questionId: qA.id } });
    const ownersOfB = await admin.questionOwnership.count({ where: { questionId: qB.id } });
    expect(ownersOfA).toBe(1);
    expect(ownersOfB).toBe(1);

    // Coin integrity: the 50-coin transfer happened exactly once (not doubled/lost).
    // The question() helper charges price 100: Alpha = 1000 - 100 (buy qA) - 50 (pay) = 850,
    // Beta = 1000 - 100 (buy qB) + 50 (receive) = 950.
    const alpha = await admin.team.findUnique({ where: { id: a.teamId } });
    const beta = await admin.team.findUnique({ where: { id: b.teamId } });
    expect(alpha!.coins).toBe(850);
    expect(beta!.coins).toBe(950);
  });
});

// ─── H2-A: host lifecycle routes ────────────────────────────────────────
describe('host lifecycle routes (H2-A)', () => {
  it('start: requires a registered team (409) and transitions LOBBY → MARKET_OPEN', async () => {
    const g = await createGame('H2 Start');

    // No team yet → the host cannot start.
    const noTeam = await request(bundle.app).post('/api/host/start').set(hostAuth(g.hostToken));
    expect(noTeam.status).toBe(409);
    expect(noTeam.body.error.code).toBe('GAME_STATE');

    await joinTeam(g.gameCode, 'Starter', 'Ada');
    const res = await request(bundle.app).post('/api/host/start').set(hostAuth(g.hostToken));
    expect(res.status).toBe(200);
    expect(res.body.game.state).toBe('MARKET_OPEN');
    expect(res.body.game.startTime).toBeTruthy();
    expect(res.body.game.endTime).toBeTruthy();
    expect(res.body.events.map((e: { type: string }) => e.type)).toEqual(
      expect.arrayContaining(['GAME_STARTED', 'MARKET_OPENED']),
    );

    // Starting again while in-play is refused.
    const again = await request(bundle.app).post('/api/host/start').set(hostAuth(g.hostToken));
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('GAME_STATE');
  });

  it('pause + resume: pause sets pausedAt (PAUSED), resume shifts the clock forward', async () => {
    const g = await createGame('H2 Pause');
    await joinTeam(g.gameCode, 'Pauser', 'Ada');
    await startGame(g.gameCode, g.hostToken);

    const paused = await request(bundle.app).post('/api/host/pause').set(hostAuth(g.hostToken));
    expect(paused.status).toBe(200);
    expect(paused.body.game.pausedAt).toBeTruthy();
    expect(paused.body.events.map((e: { type: string }) => e.type)).toContain('GAME_PAUSED');

    // Effective (display) state is PAUSED even though the persisted state stays MARKET_OPEN.
    const st1 = await request(bundle.app).get('/api/host/state').set(hostAuth(g.hostToken));
    expect(st1.body.meta.state).toBe('PAUSED');

    // Double-pause is refused.
    const again = await request(bundle.app).post('/api/host/pause').set(hostAuth(g.hostToken));
    expect(again.status).toBe(409);

    // Resume shifts start/end forward by the pause so the clock is not lost.
    const endBefore = new Date(paused.body.game.endTime).getTime();
    const resumed = await request(bundle.app).post('/api/host/resume').set(hostAuth(g.hostToken));
    expect(resumed.status).toBe(200);
    expect(resumed.body.game.pausedAt).toBeNull();
    expect(resumed.body.game.pausedTotalMs).toBeGreaterThan(0);
    expect(resumed.body.events.map((e: { type: string }) => e.type)).toContain('GAME_RESUMED');
    expect(new Date(resumed.body.game.endTime).getTime()).toBeGreaterThan(endBefore);

    const st2 = await request(bundle.app).get('/api/host/state').set(hostAuth(g.hostToken));
    expect(st2.body.meta.state).toBe('MARKET_OPEN');

    // Double-resume is refused.
    const rAgain = await request(bundle.app).post('/api/host/resume').set(hostAuth(g.hostToken));
    expect(rAgain.status).toBe(409);
  });

  it('close-market: freezes the market, refuses while paused, idempotent-reject on repeat', async () => {
    const g = await createGame('H2 Close');
    await joinTeam(g.gameCode, 'Closer', 'Ada');
    await startGame(g.gameCode, g.hostToken);

    // Cannot close while paused.
    await request(bundle.app).post('/api/host/pause').set(hostAuth(g.hostToken));
    const whilePaused = await request(bundle.app).post('/api/host/close-market').set(hostAuth(g.hostToken));
    expect(whilePaused.status).toBe(409);

    await request(bundle.app).post('/api/host/resume').set(hostAuth(g.hostToken));
    const closed = await request(bundle.app).post('/api/host/close-market').set(hostAuth(g.hostToken));
    expect(closed.status).toBe(200);
    expect(closed.body.game.state).toBe('MARKET_CLOSED');
    expect(closed.body.events.map((e: { type: string }) => e.type)).toContain('MARKET_CLOSED');

    // Already closed → 409.
    const again = await request(bundle.app).post('/api/host/close-market').set(hostAuth(g.hostToken));
    expect(again.status).toBe(409);

    // From LOBBY → 409.
    const g2 = await createGame('H2 Close Lobby');
    const lobbyClose = await request(bundle.app).post('/api/host/close-market').set(hostAuth(g2.hostToken));
    expect(lobbyClose.status).toBe(409);
    expect(lobbyClose.body.error.code).toBe('GAME_STATE');
  });

  it('finalize: locks the game COMPLETED and is idempotent (no duplicate event)', async () => {
    const g = await createGame('H2 Finalize');
    await joinTeam(g.gameCode, 'Finalizer', 'Ada');
    await startGame(g.gameCode, g.hostToken);
    await request(bundle.app).post('/api/host/close-market').set(hostAuth(g.hostToken));

    const done = await request(bundle.app).post('/api/host/finalize').set(hostAuth(g.hostToken));
    expect(done.status).toBe(200);
    expect(done.body.game.state).toBe('COMPLETED');
    expect(done.body.events.map((e: { type: string }) => e.type)).toContain('GAME_COMPLETED');

    const gameRow = await admin.game.findUnique({ where: { code: g.gameCode } });
    expect(gameRow!.state).toBe('COMPLETED');

    // Re-finalizing is a harmless no-op — exactly one GAME_COMPLETED event total.
    const again = await request(bundle.app).post('/api/host/finalize').set(hostAuth(g.hostToken));
    expect(again.status).toBe(200);
    expect(again.body.game.state).toBe('COMPLETED');
    expect(await admin.gameEvent.count({ where: { gameId: gameRow!.id, type: 'GAME_COMPLETED' } })).toBe(1);
  });

  it('reset: wipes round state back to LOBBY and restores teams', async () => {
    const g = await createGame('H2 Reset');
    const t = await joinTeam(g.gameCode, 'Resetter', 'Ada');
    const q = await createQuestion(g.hostToken, question('RST01'));
    await startGame(g.gameCode, g.hostToken);
    // Buy a question so there is round state that a reset must wipe.
    await request(bundle.app)
      .post(`/api/team/questions/${q.id}/purchase`)
      .set(hostAuth(t.teamAccessToken))
      .send({ idempotencyKey: idem() });
    const gameRow = await admin.game.findUnique({ where: { code: g.gameCode } });

    const res = await request(bundle.app).post('/api/host/reset').set(hostAuth(g.hostToken)).send({ reason: 'demo over' });
    expect(res.status).toBe(200);
    expect(res.body.game.state).toBe('LOBBY');

    // Round-scoped state was wiped: purchases, ownerships, old transactions, events.
    expect(await admin.purchase.count({ where: { gameId: gameRow!.id } })).toBe(0);
    expect(await admin.questionOwnership.count({ where: { gameId: gameRow!.id } })).toBe(0);
    expect(await admin.gameEvent.count({ where: { gameId: gameRow!.id } })).toBe(0);
    // The reset re-grants each team a single INITIAL ("Round reset") transaction.
    const txns = await admin.transaction.findMany({ where: { gameId: gameRow!.id }, orderBy: { createdAt: 'asc' } });
    expect(txns).toHaveLength(1);
    expect(txns[0]).toMatchObject({ type: 'INITIAL', amount: 1000, balanceAfter: 1000, reason: 'Round reset' });

    // Teams are restored to their starting balance and active status.
    const team = await admin.team.findUnique({ where: { id: t.teamId } });
    expect(team!.coins).toBe(1000);
    expect(team!.status).toBe('ACTIVE');
    expect(team!.score).toBe(0);
    expect(team!.purchasedCount).toBe(0);
    expect(team!.solvedCount).toBe(0);
  });

  it('audit trail: every lifecycle action records an audit entry; reset re-seeds it', async () => {
    const g = await createGame('H2 Audit');
    await joinTeam(g.gameCode, 'Auditee', 'Ada');
    await startGame(g.gameCode, g.hostToken);
    await request(bundle.app).post('/api/host/pause').set(hostAuth(g.hostToken));
    await request(bundle.app).post('/api/host/resume').set(hostAuth(g.hostToken));
    await request(bundle.app).post('/api/host/close-market').set(hostAuth(g.hostToken));
    await request(bundle.app).post('/api/host/finalize').set(hostAuth(g.hostToken));

    const auditBefore = await request(bundle.app).get('/api/host/audit').set(hostAuth(g.hostToken));
    const actions = auditBefore.body.map((a: { action: string }) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining(['START_GAME', 'PAUSE_GAME', 'RESUME_GAME', 'CLOSE_MARKET', 'FINALIZE_GAME']),
    );

    // reset wipes the old trail and records only the ROUND_RESET entry (with reason).
    await request(bundle.app).post('/api/host/reset').set(hostAuth(g.hostToken)).send({ reason: 'round 2' });
    const auditAfter = await request(bundle.app).get('/api/host/audit').set(hostAuth(g.hostToken));
    expect(auditAfter.body.map((a: { action: string }) => a.action)).toEqual(['ROUND_RESET']);
    expect(auditAfter.body[0].reason).toBe('round 2');
  });
});

// ─── H2-B: host team administration ──────────────────────────────────────
describe('host team administration (H2-B)', () => {
  it('disqualify: authenticated host can disqualify an ACTIVE team (audit + state)', async () => {
    const g = await createGame('H2B Team');
    const t = await joinTeam(g.gameCode, 'Booted', 'Ada');
    await startGame(g.gameCode, g.hostToken);

    const res = await request(bundle.app)
      .post(`/api/host/teams/${t.teamId}/disqualify`)
      .set(hostAuth(g.hostToken))
      .send({ reason: 'rule violation' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: t.teamId, status: 'DISQUALIFIED' });

    // State reflects the status; audit records the action + reason.
    const st = await request(bundle.app).get('/api/host/state').set(hostAuth(g.hostToken));
    const team = st.body.teams.find((x: { id: string }) => x.id === t.teamId);
    expect(team.status).toBe('DISQUALIFIED');
    const audit = await admin.auditLog.findFirst({ where: { gameId: st.body.meta.id, action: 'DISQUALIFY_TEAM' } });
    expect(audit).not.toBeNull();
    expect(audit!.reason).toBe('rule violation');
  });

  it('disqualify guards: non-host 403, invalid team 404, already-disqualified 409', async () => {
    const g = await createGame('H2B TeamGuards');
    const t = await joinTeam(g.gameCode, 'Guarded', 'Ada');
    await startGame(g.gameCode, g.hostToken);

    // A TEAM token is not a host → 403.
    const nonHost = await request(bundle.app)
      .post(`/api/host/teams/${t.teamId}/disqualify`)
      .set(hostAuth(t.teamAccessToken))
      .send({});
    expect(nonHost.status).toBe(403);
    expect(nonHost.body.error.code).toBe('FORBIDDEN');

    // Unknown team id → 404.
    const missing = await request(bundle.app)
      .post(`/api/host/teams/${'00000000-0000-0000-0000-000000000000'}/disqualify`)
      .set(hostAuth(g.hostToken))
      .send({});
    expect(missing.status).toBe(404);

    // Already disqualified → 409.
    await request(bundle.app).post(`/api/host/teams/${t.teamId}/disqualify`).set(hostAuth(g.hostToken)).send({});
    const again = await request(bundle.app)
      .post(`/api/host/teams/${t.teamId}/disqualify`)
      .set(hostAuth(g.hostToken))
      .send({});
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('CONFLICT');
  });

  it('reinstate: authenticated host can reinstate a disqualified team (audit + state)', async () => {
    const g = await createGame('H2B Reinstate');
    const t = await joinTeam(g.gameCode, 'Returner', 'Ada');
    await startGame(g.gameCode, g.hostToken);
    await request(bundle.app).post(`/api/host/teams/${t.teamId}/disqualify`).set(hostAuth(g.hostToken)).send({});

    const res = await request(bundle.app).post(`/api/host/teams/${t.teamId}/reinstate`).set(hostAuth(g.hostToken));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: t.teamId, status: 'ACTIVE' });

    const st = await request(bundle.app).get('/api/host/state').set(hostAuth(g.hostToken));
    const team = st.body.teams.find((x: { id: string }) => x.id === t.teamId);
    expect(team.status).toBe('ACTIVE');
    const audit = await admin.auditLog.findFirst({ where: { gameId: st.body.meta.id, action: 'REINSTATE_TEAM' } });
    expect(audit).not.toBeNull();
  });

  it('reinstate guards: invalid team 404, already-active reinstate is a harmless no-op', async () => {
    const g = await createGame('H2B ReinstateGuards');
    const t = await joinTeam(g.gameCode, 'ActiveAlready', 'Ada');
    await startGame(g.gameCode, g.hostToken);

    const missing = await request(bundle.app)
      .post(`/api/host/teams/${'00000000-0000-0000-0000-000000000000'}/reinstate`)
      .set(hostAuth(g.hostToken));
    expect(missing.status).toBe(404);

    // Reinstating a team that is already ACTIVE is idempotent (stays ACTIVE).
    const ok = await request(bundle.app).post(`/api/host/teams/${t.teamId}/reinstate`).set(hostAuth(g.hostToken));
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('ACTIVE');
  });
});

// ─── H2-B: host economy administration ───────────────────────────────────
describe('host economy administration (H2-B)', () => {
  it('add coins: host adds coins; authoritative balance + ledger + audit', async () => {
    const g = await createGame('H2B Add');
    const t = await joinTeam(g.gameCode, 'Rich', 'Ada');
    await startGame(g.gameCode, g.hostToken);

    const res = await request(bundle.app)
      .post('/api/host/coins/adjust')
      .set(hostAuth(g.hostToken))
      .send({ teamId: t.teamId, amount: 250, reason: 'tournament head start' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ balanceAfter: 1250, coins: 1250 });

    const st = await request(bundle.app).get('/api/host/state').set(hostAuth(g.hostToken));
    const team = st.body.teams.find((x: { id: string }) => x.id === t.teamId);
    expect(team.coins).toBe(1250);

    const txn = await admin.transaction.findFirst({ where: { gameId: st.body.meta.id, teamId: t.teamId, type: 'ADMIN_ADJUST' } });
    expect(txn).not.toBeNull();
    expect(txn!.amount).toBe(250);
    expect(txn!.balanceAfter).toBe(1250);
    const audit = await admin.auditLog.findFirst({ where: { gameId: st.body.meta.id, action: 'ADJUST_COINS' } });
    expect(audit).not.toBeNull();
    expect(audit!.reason).toBe('tournament head start');
  });

  it('remove coins: host removes coins; authoritative balance persists', async () => {
    const g = await createGame('H2B Remove');
    const t = await joinTeam(g.gameCode, 'Payer', 'Ada');
    await startGame(g.gameCode, g.hostToken);

    const res = await request(bundle.app)
      .post('/api/host/coins/adjust')
      .set(hostAuth(g.hostToken))
      .send({ teamId: t.teamId, amount: -300, reason: 'entry fee correction' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ balanceAfter: 700, coins: 700 });

    const st = await request(bundle.app).get('/api/host/state').set(hostAuth(g.hostToken));
    const team = st.body.teams.find((x: { id: string }) => x.id === t.teamId);
    expect(team.coins).toBe(700);
  });

  it('adjust coins guards: insufficient balance 409, invalid amount/reason 400, wallet untouched', async () => {
    const g = await createGame('H2B CoinGuards');
    const t = await joinTeam(g.gameCode, 'Broke', 'Ada');
    await startGame(g.gameCode, g.hostToken);

    // Remove more than the team has → 409 (adjustCoins guard), wallet unchanged.
    const neg = await request(bundle.app)
      .post('/api/host/coins/adjust')
      .set(hostAuth(g.hostToken))
      .send({ teamId: t.teamId, amount: -5000, reason: 'way too much' });
    expect(neg.status).toBe(409);
    expect(neg.body.error.code).toBe('CONFLICT');

    // Zero amount → 400 VALIDATION_ERROR.
    const zero = await request(bundle.app)
      .post('/api/host/coins/adjust')
      .set(hostAuth(g.hostToken))
      .send({ teamId: t.teamId, amount: 0, reason: 'zero adjustment' });
    expect(zero.status).toBe(400);
    expect(zero.body.error.code).toBe('VALIDATION_ERROR');

    // Non-integer amount → 400.
    const frac = await request(bundle.app)
      .post('/api/host/coins/adjust')
      .set(hostAuth(g.hostToken))
      .send({ teamId: t.teamId, amount: 12.5, reason: 'fractional' });
    expect(frac.status).toBe(400);

    // Reason too short → 400.
    const shortReason = await request(bundle.app)
      .post('/api/host/coins/adjust')
      .set(hostAuth(g.hostToken))
      .send({ teamId: t.teamId, amount: 1, reason: 'ab' });
    expect(shortReason.status).toBe(400);

    // Wallet was never touched by any rejected attempt.
    const st = await request(bundle.app).get('/api/host/state').set(hostAuth(g.hostToken));
    const team = st.body.teams.find((x: { id: string }) => x.id === t.teamId);
    expect(team.coins).toBe(1000);
  });

  it('refund: host refunds a valid unsolved purchase; balance + state + audit', async () => {
    const g = await createGame('H2B Refund');
    const t = await joinTeam(g.gameCode, 'Refunder', 'Ada');
    const q = await createQuestion(g.hostToken, question('RFD01'));
    await startGame(g.gameCode, g.hostToken);

    const buy = await request(bundle.app)
      .post(`/api/team/questions/${q.id}/purchase`)
      .set(hostAuth(t.teamAccessToken))
      .send({ idempotencyKey: idem() });
    expect(buy.status).toBe(200);
    expect(buy.body.balanceAfter).toBe(900);

    // The purchase is now visible on the host state (refund surface).
    const stBefore = await request(bundle.app).get('/api/host/state').set(hostAuth(g.hostToken));
    const purch = stBefore.body.purchases.find((p: { questionId: string }) => p.questionId === q.id);
    expect(purch).toMatchObject({ teamId: t.teamId, teamName: 'Refunder', questionCode: 'RFD01', price: 100, status: 'UNSOLVED' });

    const res = await request(bundle.app)
      .post('/api/host/purchases/refund')
      .set(hostAuth(g.hostToken))
      .send({ teamId: t.teamId, questionId: q.id, reason: 'duplicate purchase' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });

    // Balance restored, purchase gone, question back on the market.
    const st = await request(bundle.app).get('/api/host/state').set(hostAuth(g.hostToken));
    const team = st.body.teams.find((x: { id: string }) => x.id === t.teamId);
    expect(team.coins).toBe(1000);
    expect(st.body.purchases.some((p: { questionId: string }) => p.questionId === q.id)).toBe(false);
    const qRow = st.body.questions.find((x: { id: string }) => x.id === q.id);
    expect(qRow.status).toBe('AVAILABLE');

    const audit = await admin.auditLog.findFirst({ where: { gameId: st.body.meta.id, action: 'REFUND_PURCHASE' } });
    expect(audit).not.toBeNull();
    expect(audit!.reason).toBe('duplicate purchase');
  });

  it('refund guards: not-owned 404, solved 409, repeated refund 404', async () => {
    const g = await createGame('H2B RefundGuards');
    const t = await joinTeam(g.gameCode, 'Guardian', 'Ada');
    const qSell = await createQuestion(g.hostToken, question('RFD10'));
    const qSolved = await createQuestion(g.hostToken, question('RFD11'));
    await startGame(g.gameCode, g.hostToken);

    // Not owned by this team → 404.
    const notOwned = await request(bundle.app)
      .post('/api/host/purchases/refund')
      .set(hostAuth(g.hostToken))
      .send({ teamId: t.teamId, questionId: qSell.id, reason: 'not actually owned' });
    expect(notOwned.status).toBe(404);

    // Buy one, solve it, then refund → 409 CONFLICT.
    await request(bundle.app)
      .post(`/api/team/questions/${qSolved.id}/purchase`)
      .set(hostAuth(t.teamAccessToken))
      .send({ idempotencyKey: idem() });
    await request(bundle.app)
      .post(`/api/team/questions/${qSolved.id}/submit`)
      .set(hostAuth(t.teamAccessToken))
      .send({ idempotencyKey: idem(), answer: { kind: 'free', text: 'Yes' } });
    const solved = await request(bundle.app)
      .post('/api/host/purchases/refund')
      .set(hostAuth(g.hostToken))
      .send({ teamId: t.teamId, questionId: qSolved.id, reason: 'too late' });
    expect(solved.status).toBe(409);
    expect(solved.body.error.code).toBe('CONFLICT');

    // Refund a purchased question, then refund it again → 404 (ownership gone).
    const qBuy = await createQuestion(g.hostToken, question('RFD12'));
    await request(bundle.app)
      .post(`/api/team/questions/${qBuy.id}/purchase`)
      .set(hostAuth(t.teamAccessToken))
      .send({ idempotencyKey: idem() });
    const first = await request(bundle.app)
      .post('/api/host/purchases/refund')
      .set(hostAuth(g.hostToken))
      .send({ teamId: t.teamId, questionId: qBuy.id, reason: 'was a mistake' });
    expect(first.status).toBe(200);
    const second = await request(bundle.app)
      .post('/api/host/purchases/refund')
      .set(hostAuth(g.hostToken))
      .send({ teamId: t.teamId, questionId: qBuy.id, reason: 'double refund' });
    expect(second.status).toBe(404);
  });
});

// ─── H2-C: host trade administration ────────────────────────────────────
describe('host trade administration (H2-C)', () => {
  let g: Awaited<ReturnType<typeof createGame>>;
  let gameId: string;
  let a: Awaited<ReturnType<typeof joinTeam>>;
  let b: Awaited<ReturnType<typeof joinTeam>>;
  // Three independent pending offers (each own question pair) so the tests stay
  // deterministic: a list/guard target, a cancel target, a realtime target.
  let pairs: { offered: Awaited<ReturnType<typeof createQuestion>>; requested: Awaited<ReturnType<typeof createQuestion>>; tradeId: string }[] = [];

  const code = (i: number, side: 'O' | 'R') => `H2C${i}${side}`;

  beforeAll(async () => {
    g = await createGame('H2C Trade Admin');
    gameId = (await admin.game.findUnique({ where: { code: g.gameCode } }))!.id;
    a = await joinTeam(g.gameCode, 'Trade Alpha', 'Ada');
    b = await joinTeam(g.gameCode, 'Trade Beta', 'Lin');
    const created: { offered: Awaited<ReturnType<typeof createQuestion>>; requested: Awaited<ReturnType<typeof createQuestion>> }[] = [];
    for (let i = 1; i <= 3; i++) {
      const offered = await createQuestion(g.hostToken, question(code(i, 'O')));
      const requested = await createQuestion(g.hostToken, question(code(i, 'R')));
      created.push({ offered, requested });
    }
    await startGame(g.gameCode, g.hostToken);
    // Purchases MUST happen after startGame (canBuy=true) — LOBBY has canBuy=false.
    for (let i = 1; i <= 3; i++) {
      const pair = created[i - 1]!;
      await request(bundle.app)
        .post(`/api/team/questions/${pair.offered.id}/purchase`)
        .set(hostAuth(a.teamAccessToken))
        .send({ idempotencyKey: idem() });
      await request(bundle.app)
        .post(`/api/team/questions/${pair.requested.id}/purchase`)
        .set(hostAuth(b.teamAccessToken))
        .send({ idempotencyKey: idem() });
    }
    for (let i = 1; i <= 3; i++) {
      const pair = created[i - 1]!;
      const res = await request(bundle.app)
        .post('/api/team/trades')
        .set(hostAuth(a.teamAccessToken))
        .send({
          targetTeamId: b.teamId,
          offeredQuestionId: pair.offered.id,
          requestedQuestionId: pair.requested.id,
          coins: i === 1 ? 25 : 0,
          idempotencyKey: idem(),
        });
      expect(res.status).toBe(200);
      pairs.push({ ...pair, tradeId: res.body.tradeId as string });
    }
  });

  it('exposes pending trades in host state: source/target/question/coins/status/timestamps', async () => {
    const res = await request(bundle.app).get('/api/host/state').set(hostAuth(g.hostToken));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.trades)).toBe(true);
    const t = res.body.trades.find((x: { id: string }) => x.id === pairs[0]!.tradeId);
    expect(t).toBeDefined();
    const tt = t!;
    expect(tt).toMatchObject({
      state: 'OPEN',
      coins: 25,
      fromTeam: { id: a.teamId, name: 'Trade Alpha' },
      toTeam: { id: b.teamId, name: 'Trade Beta' },
    });
    expect(tt.expiresAt).toBeTruthy();
    expect(tt.createdAt).toBeTruthy();
    expect(tt.offered.map((q: { code: string }) => q.code)).toEqual(['H2C1O']);
    expect(tt.requested.map((q: { code: string }) => q.code)).toEqual(['H2C1R']);
  });

  it('refuses a team token on the host cancel route (403)', async () => {
    const res = await request(bundle.app)
      .post(`/api/host/trades/${pairs[0]!.tradeId}/cancel`)
      .set(hostAuth(a.teamAccessToken))
      .send({ reason: 'nope' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    // The trade is untouched — still pending.
    const trade = await admin.trade.findUnique({ where: { id: pairs[0]!.tradeId } });
    expect(trade!.state).toBe('OPEN');
  });

  it('rejects an unknown trade id and a trade from another game (404)', async () => {
    const bad = await request(bundle.app)
      .post(`/api/host/trades/${'00000000-0000-0000-0000-000000000000'}/cancel`)
      .set(hostAuth(g.hostToken))
      .send({ reason: 'oops' });
    expect(bad.status).toBe(404);
    expect(bad.body.error.code).toBe('NOT_FOUND');

    // A trade that belongs to a DIFFERENT game must not be cancellable here.
    const g2 = await createGame('H2C Foreign');
    const ta2 = await joinTeam(g2.gameCode, 'Foreign A', 'Ada');
    const tb2 = await joinTeam(g2.gameCode, 'Foreign B', 'Lin');
    const o2 = await createQuestion(g2.hostToken, question('H2CFO'));
    const r2 = await createQuestion(g2.hostToken, question('H2CFR'));
    await startGame(g2.gameCode, g2.hostToken);
    await request(bundle.app).post(`/api/team/questions/${o2.id}/purchase`).set(hostAuth(ta2.teamAccessToken)).send({ idempotencyKey: idem() });
    await request(bundle.app).post(`/api/team/questions/${r2.id}/purchase`).set(hostAuth(tb2.teamAccessToken)).send({ idempotencyKey: idem() });
    const prop = await request(bundle.app).post('/api/team/trades').set(hostAuth(ta2.teamAccessToken)).send({
      targetTeamId: tb2.teamId,
      offeredQuestionId: o2.id,
      requestedQuestionId: r2.id,
      coins: 0,
      idempotencyKey: idem(),
    });
    expect(prop.status).toBe(200);
    const foreign = await request(bundle.app)
      .post(`/api/host/trades/${prop.body.tradeId}/cancel`)
      .set(hostAuth(g.hostToken)) // host of the FIRST game
      .send({ reason: 'cross game' });
    expect(foreign.status).toBe(404);
    expect(foreign.body.error.code).toBe('NOT_FOUND');
  });

  it('host cancels a pending trade → CANCELLED, locks released, no longer active, audited + evented', async () => {
    const tid = pairs[1]!.tradeId;
    const before = await admin.gameEvent.count({ where: { gameId: gameId, type: 'TRADE_CANCELLED' } });

    const res = await request(bundle.app)
      .post(`/api/host/trades/${tid}/cancel`)
      .set(hostAuth(g.hostToken))
      .send({ reason: 'disputed offer' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });

    // State transition + timestamps.
    const trade = await admin.trade.findUnique({ where: { id: tid } });
    expect(trade!.state).toBe('CANCELLED');
    expect(trade!.resolvedAt).not.toBeNull();

    // The trade-locked questions are released.
    for (const pid of [pairs[1]!.offered.id, pairs[1]!.requested.id]) {
      const o = await admin.questionOwnership.findUnique({ where: { questionId: pid } });
      expect(o!.tradeLock).toBe(false);
    }

    // Audit entry records the action + reason; TRADE_CANCELLED event was created.
    const audit = await admin.auditLog.findFirst({ where: { gameId: gameId, action: 'ADMIN_CANCEL_TRADE' } });
    expect(audit).not.toBeNull();
    expect(audit!.reason).toBe('disputed offer');
    expect(audit!.actorType).toBe('HOST');
    expect(await admin.gameEvent.count({ where: { gameId: gameId, type: 'TRADE_CANCELLED' } })).toBe(before + 1);

    // Host state no longer presents it as an active (OPEN) trade.
    const st = await request(bundle.app).get('/api/host/state').set(hostAuth(g.hostToken));
    const t = st.body.trades.find((x: { id: string }) => x.id === tid);
    expect(t!.state).toBe('CANCELLED');
    expect(st.body.trades.some((x: { id: string; state: string }) => x.id === tid && x.state === 'OPEN')).toBe(false);
  });

  it('duplicate cancellation of the same trade is refused (409 CONFLICT)', async () => {
    const res = await request(bundle.app)
      .post(`/api/host/trades/${pairs[1]!.tradeId}/cancel`)
      .set(hostAuth(g.hostToken))
      .send({ reason: 'twice' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    const t = await admin.trade.findUnique({ where: { id: pairs[1]!.tradeId } });
    expect(t!.state).toBe('CANCELLED');
  });

  it('cannot cancel an already-accepted (EXECUTED) trade (409)', async () => {
    const tid = pairs[0]!.tradeId;
    // Beta accepts → EXECUTED.
    const accept = await request(bundle.app)
      .post(`/api/team/trades/${tid}/accept`)
      .set(hostAuth(b.teamAccessToken))
      .send({ idempotencyKey: idem() });
    expect(accept.status).toBe(200);
    expect(accept.body.trade.state).toBe('EXECUTED');

    // Host cancel is refused and the EXECUTED state is left untouched.
    const cancel = await request(bundle.app)
      .post(`/api/host/trades/${tid}/cancel`)
      .set(hostAuth(g.hostToken))
      .send({ reason: 'too late' });
    expect(cancel.status).toBe(409);
    expect(cancel.body.error.code).toBe('CONFLICT');
    const t = await admin.trade.findUnique({ where: { id: tid } });
    expect(t!.state).toBe('EXECUTED');
  });

  it('an expired trade shows as EXPIRED (not active) and is not cancellable', async () => {
    // Pair 3 is still OPEN and untouched — expire it deterministically.
    const pair3 = pairs[2]!;
    const tid = pair3.tradeId;
    await admin.trade.update({ where: { id: tid }, data: { expiresAt: new Date(Date.now() - 1_000) } });
    const { expireStaleTrades } = await import('../src/domain/trades');
    const { prisma } = await import('../src/lib/prisma');
    const game = await admin.game.findUnique({ where: { code: g.gameCode } });
    const events = await expireStaleTrades(prisma, game!);
    expect(events.some((e: any) => e.type === 'TRADE_EXPIRED')).toBe(true);

    const st = await request(bundle.app).get('/api/host/state').set(hostAuth(g.hostToken));
    const t = st.body.trades.find((x: { id: string }) => x.id === tid);
    expect(t.state).toBe('EXPIRED');
    expect(st.body.trades.some((x: { id: string; state: string }) => x.id === tid && x.state === 'OPEN')).toBe(false);

    const cancel = await request(bundle.app)
      .post(`/api/host/trades/${tid}/cancel`)
      .set(hostAuth(g.hostToken))
      .send({ reason: 'already gone' });
    expect(cancel.status).toBe(409);
    expect(cancel.body.error.code).toBe('CONFLICT');
  });

  it('live host: TRADE_CANCELLED broadcasts and the host resync shows the cancelled trade', async () => {
    // A fresh pending offer so the realtime path has an OPEN trade to cancel.
    const o = await createQuestion(g.hostToken, question('H2CLO'));
    const r = await createQuestion(g.hostToken, question('H2CLR'));
    await request(bundle.app).post(`/api/team/questions/${o.id}/purchase`).set(hostAuth(a.teamAccessToken)).send({ idempotencyKey: idem() });
    await request(bundle.app).post(`/api/team/questions/${r.id}/purchase`).set(hostAuth(b.teamAccessToken)).send({ idempotencyKey: idem() });
    const prop = await request(bundle.app).post('/api/team/trades').set(hostAuth(a.teamAccessToken)).send({
      targetTeamId: b.teamId,
      offeredQuestionId: o.id,
      requestedQuestionId: r.id,
      coins: 0,
      idempotencyKey: idem(),
    });
    expect(prop.status).toBe(200);
    const tid = prop.body.tradeId as string;

    const sock = hostSocket(g.gameCode, g.hostToken);
    // Initial host snapshot already carries the OPEN trade.
    const sync0 = await once<{ trades: { id: string; state: string }[] }>(sock, 'state:sync');
    const openInState = sync0.trades.find((x) => x.id === tid);
    expect(openInState).toBeDefined();
    expect(openInState!.state).toBe('OPEN');

    // Cancel via the host API → the host socket hears TRADE_CANCELLED.
    const ev = once<{ type: string }>(sock, 'game:event');
    const res = await request(bundle.app)
      .post(`/api/host/trades/${tid}/cancel`)
      .set(hostAuth(g.hostToken))
      .send({ reason: 'live host' });
    expect(res.status).toBe(200);
    expect((await ev).type).toBe('TRADE_CANCELLED');

    // A fresh state:sync pulled over the socket reports CANCELLED, not active.
    const syncP = once<{ trades: { id: string; state: string }[] }>(sock, 'state:sync');
    sock.emit('req:state', { lastSeq: 0 });
    const sync1 = await syncP;
    const done = sync1.trades.find((x) => x.id === tid);
    expect(done).toBeDefined();
    expect(done!.state).toBe('CANCELLED');
    sock.disconnect();
  });
});

// ─── H2-D: host realtime & polish ────────────────────────────────────────
describe('host realtime & polish (H2-D)', () => {
  it('host socket receives full host-shaped state:sync with teams, purchases, trades, activity', async () => {
    const g = await createGame('H2D FullState');
    const t = await joinTeam(g.gameCode, 'H2D Team', 'Ada');
    const q = await createQuestion(g.hostToken, question('H2DFS1'));
    await startGame(g.gameCode, g.hostToken);
    // Buy the question so we get purchases in the host state.
    await request(bundle.app)
      .post(`/api/team/questions/${q.id}/purchase`)
      .set(hostAuth(t.teamAccessToken))
      .send({ idempotencyKey: idem() });

    const sock = hostSocket(g.gameCode, g.hostToken);
    const sync = await once<{
      meta: { code: string; state: string };
      teams: { id: string; name: string; coins: number }[];
      purchases: { questionCode: string; teamId: string }[];
      trades: { id: string; state: string }[];
      activity: { message: string; seq: number; at: number }[];
      lastEventSeq: number;
    }>(sock, 'state:sync');

    // Host-shaped state must include every major section.
    expect(sync.meta.code).toBe(g.gameCode);
    expect(sync.meta.state).toBe('MARKET_OPEN');
    expect(Array.isArray(sync.teams)).toBe(true);
    expect(sync.teams.length).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(sync.purchases)).toBe(true);
    expect(sync.purchases.length).toBeGreaterThanOrEqual(1);
    expect(sync.purchases[0]!.questionCode).toBe('H2DFS1');
    expect(Array.isArray(sync.trades)).toBe(true);
    expect(Array.isArray(sync.activity)).toBe(true);
    expect(sync.activity.length).toBeGreaterThan(0);
    expect(typeof sync.lastEventSeq).toBe('number');
    expect(sync.lastEventSeq).toBeGreaterThan(0);
    sock.disconnect();
  });

  it('host receives game:event and converges to fresh authoritative state', async () => {
    const g = await createGame('H2D EventConverge');
    const t = await joinTeam(g.gameCode, 'H2D Conv', 'Ada');
    await startGame(g.gameCode, g.hostToken);

    const sock = hostSocket(g.gameCode, g.hostToken);
    await once<{ meta: { state: string } }>(sock, 'state:sync'); // initial sync

    // Emit a host announcement → triggers game:event on the host socket.
    const ev = once<{ type: string }>(sock, 'game:event');
    const ann = await request(bundle.app)
      .post('/api/host/announcements')
      .set(hostAuth(g.hostToken))
      .send({ message: 'H2D convergence test' });
    expect(ann.status).toBe(200);
    const event = await ev;
    expect(event.type).toBe('ANNOUNCEMENT_CREATED');

    // After the event, a state:sync must arrive with the latest activity.
    const syncP = once<{
      activity: { message: string }[];
      lastEventSeq: number;
    }>(sock, 'state:sync');
    sock.emit('req:state', { lastSeq: 0 });
    const sync = await syncP;
    expect(sync.activity.some((a) => a.message.includes('H2D convergence test'))).toBe(true);
    sock.disconnect();
  });

  it('GAME_RELOAD after resetRound delivers reload event and state resets to LOBBY', async () => {
    const g = await createGame('H2D Reload');
    const t = await joinTeam(g.gameCode, 'H2D ReloadTeam', 'Ada');
    await startGame(g.gameCode, g.hostToken);

    const sock = hostSocket(g.gameCode, g.hostToken);
    const initial = await once<{ meta: { state: string } }>(sock, 'state:sync');
    expect(initial.meta.state).toBe('MARKET_OPEN');

    // Collect all events from this point forward.
    const received: string[] = [];
    sock.onAny((ev) => received.push(ev));

    const reset = await request(bundle.app)
      .post('/api/host/reset')
      .set(hostAuth(g.hostToken))
      .send({ reason: 'H2D reload test' });
    expect(reset.status).toBe(200);

    // Wait until the reload event arrives (it fires synchronously on the server).
    await new Promise<void>((resolve, reject) => {
      const deadline = setTimeout(() => {
        reject(new Error(`timeout — received events: ${received.join(', ')}`));
      }, 6000);
      const poll = () => {
        if (received.includes('reload')) { clearTimeout(deadline); resolve(); }
        else setTimeout(poll, 30);
      };
      poll();
    });

    expect(received).toContain('reload');
    // The GAME_RELOAD event was also broadcast.
    expect(received).toContain('game:event');

    // Server-side: authoritative state must be LOBBY after reset.
    const st = await request(bundle.app).get('/api/host/state').set(hostAuth(g.hostToken));
    expect(st.body.meta.state).toBe('LOBBY');

    // A fresh host socket must receive LOBBY state (proves state was persisted).
    const sock2 = hostSocket(g.gameCode, g.hostToken);
    const sync = await once<{ meta: { state: string } }>(sock2, 'state:sync');
    expect(sync.meta.state).toBe('LOBBY');
    sock.removeAllListeners();
    sock.disconnect();
    sock2.disconnect();
  });

  it('unauthorized host socket is rejected with INVALID_TOKEN', async () => {
    const g = await createGame('H2D Unauth');
    const sock = io(baseUrl, {
      query: { gameCode: g.gameCode, token: 'totally-bogus-token', role: 'host', lastSeq: '0' },
      transports: ['websocket'],
      forceNew: true,
    });
    const err = await once<{ code: string }>(sock, 'error');
    expect(err.code).toBe('UNAUTHORIZED');
    sock.disconnect();
  });
});
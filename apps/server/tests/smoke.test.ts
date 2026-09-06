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
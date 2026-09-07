/**
 * STEP 3 runtime verification — Team marketplace end-to-end.
 * Two real browser contexts (two seats of one team) against the real backend.
 *
 * Because the host console buttons are NOT yet wired to the API, the host
 * phase-driving step uses the REAL host REST endpoints with the REAL host
 * token captured from the Create Game UI (exactly the calls the host UI will
 * one day dispatch). Everything team-side runs through the real UI + socket.
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:5173';
const API = `${BASE}/api`;

const results = [];
const record = (name, ok, detail = '') =>
  results.push({ name, ok: ok ? 'PASS' : 'FAIL', detail: detail || (ok ? '' : 'see trace') });

const check = async (name, fn, { timeout = 30000 } = {}) => {
  try {
    await Promise.race([
      fn(),
      new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout after ${timeout}ms`)), timeout)),
    ]);
    record(name, true);
  } catch (e) {
    record(name, false, e.message.split('\n').slice(0, 14).join('\n'));
  }
};

const apiJson = async (path, { method = 'GET', token = '', body } = {}) => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  return { status: res.status, data };
};

// Wallet value shown in the TeamShell header (server-authoritative coins).
async function waitWallet(page, val) {
  await page.waitForFunction(
    (v) => {
      const el = document.querySelector('[title="Team coins (server-authoritative)"] span');
      return el && el.innerText.trim() === v;
    },
    val,
    { timeout: 25000 },
  );
}

// Navigate via SPA (client-side router) — wait for wallet to reappear (socket reconnect + state:sync)
async function gotoPage(page, path) {
  await page.goto(`${BASE}${path}`);
  await page.waitForSelector('[title="Team coins (server-authoritative)"] span', { timeout: 25000 });
  await page.waitForTimeout(500); // allow state:sync to land
}

async function buyState(page, code) {
  const btn = page.locator(`div.rounded-xl:has-text("${code}") button:has-text("BUY")`).first();
  if ((await btn.count()) === 0) return 'none';
  return (await btn.innerText()).trim();
}

async function marketCount(page) {
  const body = await page.locator('body').innerText();
  const m = /MARKETPLACE\s*\((\d+)\)/.exec(body);
  return m ? parseInt(m[1], 10) : -1;
}

async function inventoryCount(page) {
  const body = await page.locator('body').innerText();
  const m = /INVENTORY\s*\((\d+)\)/.exec(body);
  return m ? parseInt(m[1], 10) : -1;
}

async function waitForInventoryItem(page, code) {
  await page.waitForFunction(
    (c) => document.body.innerText.includes(c),
    code,
    { timeout: 20000 },
  );
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  let gameCode = '';
  let hostToken = '';

  // ─────────────────────────────────────────────────────────────────────
  // HOST — create a game through the real UI
  // ─────────────────────────────────────────────────────────────────────
  await check('Host creates game', async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${BASE}/create`);
    await page.fill('input#title', 'E2E Marketplace Test');
    await page.click('button:has-text("CREATE GAME")');
    await page.waitForSelector('text=GAME CREATED', { timeout: 15000 });
    const body = await page.locator('body').innerText();
    const code = /GAME CODE\s*\n([A-Z0-9]{4,8})/.exec(body)?.[1];
    const token = /([0-9a-f]{64})/.exec(body)?.[1];
    if (!code || !token) throw new Error(`could not parse code/token from:\n${body}`);
    gameCode = code;
    hostToken = token;
    await ctx.close();
  });

  // ─────────────────────────────────────────────────────────────────────
  // HOST — seed the marketplace via the real host API (host UI not wired yet)
  // questions: E2E1 EASY 120 / E2E2 EXTREME 750 / E2E3 EASY but price 2000
  // ─────────────────────────────────────────────────────────────────────
  await check('Host adds marketplace questions (API)', async () => {
    const questions = [
      { code: 'E2E1', type: 'MULTIPLE_CHOICE', difficulty: 'EASY', category: 'C SYNTAX', title: 'Q easy buy', body: 'one', price: 120, reward: 250, answerData: { type: 'MULTIPLE_CHOICE', options: ['a', 'b'], correctIndex: 0 } },
      { code: 'E2E2', type: 'MULTIPLE_CHOICE', difficulty: 'EXTREME', category: 'POINTERS', title: 'Q race target', body: 'two', price: 750, reward: 1300, answerData: { type: 'MULTIPLE_CHOICE', options: ['x', 'y'], correctIndex: 1 } },
      { code: 'E2E3', type: 'MULTIPLE_CHOICE', difficulty: 'EASY', category: 'VARIABLES', title: 'Q too expensive', body: 'three', price: 2000, reward: 2100, answerData: { type: 'MULTIPLE_CHOICE', options: ['m', 'n'], correctIndex: 0 } },
    ];
    for (const q of questions) {
      const { status, data } = await apiJson('/host/questions', { method: 'POST', token: hostToken, body: q });
      if (status !== 200 && status !== 201) throw new Error(`add ${q.code} → ${status}: ${JSON.stringify(data)}`);
    }
    const { status, data } = await apiJson('/host/state', { token: hostToken });
    if (status !== 200) throw new Error(`host state → ${status}`);
    const count = data.questions?.filter((x) => x.code.startsWith('E2E')).length ?? 0;
    if (count !== 3) throw new Error(`expected 3 E2E questions, got ${count}`);
  });

  // ─────────────────────────────────────────────────────────────────────
  // PLAYER 1 — join through the real UI, capture the REAL team token from the
  // join response (this is the token P1 would share with their partner)
  // ─────────────────────────────────────────────────────────────────────
  let teamToken = '';
  let p1, p2, p1ctx, p2ctx;
  await check('Player 1 joins game/team', async () => {
    p1ctx = await browser.newContext();
    p1 = await p1ctx.newPage();
    let tokenFromResp = '';
    p1.on('response', async (res) => {
      if (res.url().includes('/teams/join') && res.status() === 200) {
        const j = await res.json().catch(() => null);
        if (j?.teamAccessToken) tokenFromResp = j.teamAccessToken;
      }
    });
    await p1.goto(`${BASE}/join`);
    await p1.fill('input#code', gameCode);
    await p1.fill('input#teamName', 'Team Alpha');
    await p1.fill('input#p1', 'Ada');
    await p1.fill('input#p2', 'Grace');
    await p1.click('button:has-text("JOIN GAME")');
    // lands on /team (TeamShell) → wallet appears once state:sync lands
    await waitWallet(p1, '1,000');
    if (!tokenFromResp) throw new Error('team token not captured from join response');
    teamToken = tokenFromResp;
  });

  // Lobby identity + single-seat presence
  await check('Player 1 sees team identity + 1/2 presence', async () => {
    await p1.waitForSelector('text=Team Alpha', { timeout: 15000 });
    await p1.waitForSelector('text=1/2 players connected', { timeout: 15000 });
  });

  // ─────────────────────────────────────────────────────────────────────
  // PLAYER 2 — second browser context, join-existing with the SAME token
  // ─────────────────────────────────────────────────────────────────────
  await check('Player 2 joins SAME team via join-existing', async () => {
    p2ctx = await browser.newContext();
    p2 = await p2ctx.newPage();
    await p2.goto(`${BASE}/join-existing`);
    await p2.fill('input#code', gameCode);
    await p2.fill('input#token', teamToken);
    await p2.click('button:has-text("REJOIN TEAM")');
    await waitWallet(p2, '1,000');
  });

  // Two-seat presence sync (both contexts report 2/2)
  await check('Two-seat presence sync both clients', async () => {
    await p1.waitForSelector('text=2/2 players connected', { timeout: 15000 });
    await p2.waitForSelector('text=2/2 players connected', { timeout: 15000 });
  });

  // Marketplace identity + wallet sync before start (both on /team/market)
  await check('Wallet + marketplace sync before start (LOBBY)', async () => {
    await gotoPage(p1, '/team/market');
    await gotoPage(p2, '/team/market');
    // wait for marketplace grid to render (codes appear in body text)
    await p1.waitForFunction(
      () => document.body.innerText.includes('E2E1'),
      undefined,
      { timeout: 15000 },
    );
    await p2.waitForFunction(
      () => document.body.innerText.includes('E2E1'),
      undefined,
      { timeout: 15000 },
    );
    if ((await marketCount(p1)) !== 3 || (await marketCount(p2)) !== 3) throw new Error('marketplace count mismatch');
    // In LOBBY, buttons read "MARKET CLOSED" — check the button text on the card directly
    const btnText1 = await p1.locator(`div.rounded-xl:has-text("E2E1") button`).first().innerText();
    const btnText2 = await p2.locator(`div.rounded-xl:has-text("E2E1") button`).first().innerText();
    if (!btnText1.includes('MARKET CLOSED')) throw new Error(`P1 btn="${btnText1}"`);
    if (!btnText2.includes('MARKET CLOSED')) throw new Error(`P2 btn="${btnText2}"`);
  });

  // ─────────────────────────────────────────────────────────────────────
  // HOST — start the game (real API; host console UI not wired yet)
  // ─────────────────────────────────────────────────────────────────────
  await check('Host starts game (API) → MARKET_OPEN', async () => {
    const { status, data } = await apiJson('/host/start', { method: 'POST', token: hostToken });
    if (status !== 200) throw new Error(`start → ${status}: ${JSON.stringify(data)}`);
    const s2 = await apiJson('/host/state', { token: hostToken });
    if (s2.data?.meta?.state !== 'MARKET_OPEN') throw new Error(`state=${s2.data?.meta?.state}`);
  });

  // Phase + wallet + marketplace sync after start
  await check('Phase sync + buys enabled on both clients', async () => {
    for (const page of [p1, p2]) {
      await page.waitForSelector('text=MARKET OPEN', { timeout: 15000 }); // PhaseBanner from time:sync
      await page.waitForFunction(
        () => !!Array.from(document.querySelectorAll('button')).find((b) => b.innerText.trim() === 'BUY'),
        undefined,
        { timeout: 15000 },
      );
      if ((await buyState(page, 'E2E1')) !== 'BUY') throw new Error('E2E1 BUY not enabled');
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // PURCHASE — Player 1 buys E2E1 (120) through the real UI + real idempotency key
  // ─────────────────────────────────────────────────────────────────────
  await check('Purchase succeeds (Player 1, E2E1)', async () => {
    await p1.locator(`div.rounded-xl:has-text("E2E1") button:has-text("BUY")`).first().click();
    await p1.waitForSelector('[role="status"]:has-text("Purchased!")', { timeout: 10000 });
    await waitWallet(p1, '880');
  });
  await check('Player 1 wallet decreased correctly', async () => {
    const w = await p1.locator('[title="Team coins (server-authoritative)"] span').innerText();
    if (w.trim() !== '880') throw new Error(`expected 880 got ${w}`);
  });
  await check('E2E1 no longer offered on Player 1 market', async () => {
    await p1.waitForFunction(
      () => !document.body.innerText.includes('E2E1'),
      undefined,
      { timeout: 15000 },
    );
    if ((await marketCount(p1)) !== 2) throw new Error('marketplace still has 3');
  });
  await check('E2E1 owned in Player 1 inventory (UNSOLVED)', async () => {
    await gotoPage(p1, '/team/inventory');
    if ((await inventoryCount(p1)) !== 1) throw new Error('inv count mismatch');
    await waitForInventoryItem(p1, 'E2E1');
    await p1.waitForSelector('text=UNSOLVED', { timeout: 10000 });
  });

  // Player 2 sees the purchase via authoritative resync
  await check('Purchase reflected on Player 2 (wallet + market + inventory)', async () => {
    await waitWallet(p2, '880');
    await p2.waitForFunction(
      () => !document.body.innerText.includes('E2E1'),
      undefined,
      { timeout: 15000 },
    );
    await gotoPage(p2, '/team/inventory');
    if ((await inventoryCount(p2)) !== 1) throw new Error('P2 inv count mismatch');
    await waitForInventoryItem(p2, 'E2E1');
    await p2.waitForSelector('text=UNSOLVED', { timeout: 10000 });
    await gotoPage(p2, '/team/market');
  });

  // ─────────────────────────────────────────────────────────────────────
  // INSUFFICIENT FUNDS — Player 1 tries E2E3 (2000 > 880)
  // ─────────────────────────────────────────────────────────────────────
  await check('Insufficient funds rejected (E2E3, 2000 > 880)', async () => {
    await gotoPage(p1, '/team/market');
    await p1.waitForFunction(
      () => !!Array.from(document.querySelectorAll('button')).find((b) => b.innerText.trim() === 'BUY'),
      undefined,
      { timeout: 15000 },
    );
    await p1.locator(`div.rounded-xl:has-text("E2E3") button:has-text("BUY")`).first().click();
    await p1.waitForSelector('[role="status"]:has-text("Purchase failed")', { timeout: 10000 });
  });
  await check('Wallet unchanged + never negative after failed buy', async () => {
    const w = await p1.locator('[title="Team coins (server-authoritative)"] span').innerText();
    if (w.trim() !== '880') throw new Error(`expected 880 got ${w}`);
  });
  await check('Rejected question still available both clients', async () => {
    if ((await buyState(p1, 'E2E3')) !== 'BUY') throw new Error('E2E3 gone on P1');
    await waitWallet(p2, '880');
    if ((await buyState(p2, 'E2E3')) !== 'BUY') throw new Error('E2E3 gone on P2');
  });

  // ─────────────────────────────────────────────────────────────────────
  // CONCURRENT RACE — both seats click E2E2 (750) at the same time
  // ─────────────────────────────────────────────────────────────────────
  await check('Concurrent purchase race (both seats hammer E2E2)', async () => {
    await gotoPage(p1, '/team/market');
    await gotoPage(p2, '/team/market');
    await p1.waitForFunction(
      () => !!Array.from(document.querySelectorAll('button')).find((b) => b.innerText.trim() === 'BUY'),
      undefined,
      { timeout: 15000 },
    );
    await p2.waitForFunction(
      () => !!Array.from(document.querySelectorAll('button')).find((b) => b.innerText.trim() === 'BUY'),
      undefined,
      { timeout: 15000 },
    );
    const b1 = p1.locator(`div.rounded-xl:has-text("E2E2") button:has-text("BUY")`).first();
    const b2 = p2.locator(`div.rounded-xl:has-text("E2E2") button:has-text("BUY")`).first();
    if ((await b1.count()) !== 1 || (await b2.count()) !== 1) throw new Error('E2E2 BUY button missing on one client');
    await Promise.all([b1.click().catch(() => {}), b2.click().catch(() => {})]);
  });

  await check('Exactly one purchase wins the race; no double ownership', async () => {
    // converge on final authoritative state from the server
    await p1.waitForTimeout(3000);
    const st = await apiJson('/team/state', { token: teamToken });
    const owned = st.data?.inventory?.filter((i) => i.question.code === 'E2E2').length ?? -1;
    const walletN = st.data?.team?.coins;
    if (owned !== 1) throw new Error(`E2E2 owned count = ${owned} (want 1)`);
    if (walletN !== 130) throw new Error(`wallet = ${walletN} (want 130 = 1000 - 120 - 750)`);
    if (walletN < 0) throw new Error('NEGATIVE WALLET');
  });

  await check('Both clients converge on final authoritative state', async () => {
    await waitWallet(p1, '130');
    await waitWallet(p2, '130');
    for (const [page, who] of [[p1, 'P1'], [p2, 'P2']]) {
      await gotoPage(page, '/team/inventory');
      if ((await inventoryCount(page)) !== 2) throw new Error(`${who} inv count mismatch`);
      await waitForInventoryItem(page, 'E2E1');
      await waitForInventoryItem(page, 'E2E2');
      await page.waitForSelector('text=UNSOLVED', { timeout: 10000 });
    }
  });

  await p1ctx?.close?.().catch(() => {});
  await p2ctx?.close?.().catch(() => {});
  await browser.close();

  // ─────────────────────────────────────────────────────────────────────
  console.log('\n===== STEP 3 RUNTIME VERIFICATION =====');
  let pass = 0, fail = 0;
  for (const r of results) {
    if (r.ok === 'PASS') pass += 1; else fail += 1;
    console.log(`${r.ok === 'PASS' ? '✅' : '❌'} ${r.name}`);
    if (r.ok !== 'PASS') console.log(`   ${r.detail.split('\n').join('\n   ')}`);
  }
  console.log(`\n${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error('E2E harness crashed:', e);
  process.exit(2);
});
/**
 * STEP 4 runtime verification — Solve flow end-to-end (BUY → INVENTORY → SOLVE → SUBMIT → REWARD).
 * Two real browser contexts (two seats of one team) against the real backend.
 *
 * Questions are seeded through the real host API with DETERMINISTIC grading
 * (offline predefined answers — the server never executes participant code):
 *   S01 WILL_IT_COMPILE accepted ['yes','it compiles']   price 100 reward 200
 *   S02 WILL_IT_COMPILE accepted ['yes']                 price 150 reward 300
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

// Navigate via SPA — wait for wallet to reappear (socket reconnect + state:sync)
async function gotoPage(page, path) {
  await page.goto(`${BASE}${path}`);
  await page.waitForSelector('[title="Team coins (server-authoritative)"] span', { timeout: 25000 });
  await page.waitForTimeout(500); // allow state:sync to land
}

async function inventoryCount(page) {
  const body = await page.locator('body').innerText();
  const m = /INVENTORY\s*\((\d+)\)/.exec(body);
  return m ? parseInt(m[1], 10) : -1;
}

async function ownsCodeWithStatus(page, code, status) {
  // Find the inventory card containing `code` and confirm its status badge
  // matches `status` exactly (whole token — 'UNSOLVED' contains 'SOLVED').
  return page.evaluate(({ code, status }) => {
    const cards = Array.from(document.querySelectorAll('div.rounded-xl'));
    const card = cards.find((c) => c.innerText.includes(code));
    if (!card) return false;
    const badge = Array.from(card.querySelectorAll('span'))
      .map((s) => s.innerText.trim())
      .find((t) => t === 'UNSOLVED' || t === 'SOLVED' || t === 'FAILED');
    return badge === status;
  }, { code, status });
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  let gameCode = '';
  let hostToken = '';
  let teamToken = '';
  let p1, p2, p1ctx, p2ctx;

  // Host creates a game through the real UI
  await check('Host creates game', async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${BASE}/create`);
    await page.fill('input#title', 'E2E Solve Test');
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

  // Seed deterministic questions via the real host API
  await check('Host adds deterministic solve questions (API)', async () => {
    const questions = [
      { code: 'S01', type: 'WILL_IT_COMPILE', difficulty: 'EASY', category: 'COMPILATION', title: 'S one compiles?', body: 'Will this C program compile?', codeSnippet: 'int main(void){ return 0; }', price: 100, reward: 200, hint: null, answerData: { type: 'WILL_IT_COMPILE', matchMode: 'NORMALIZED', accepted: ['yes', 'it compiles'] } },
      { code: 'S02', type: 'WILL_IT_COMPILE', difficulty: 'EASY', category: 'COMPILATION', title: 'S two compiles?', body: 'Will this C program compile?', codeSnippet: 'int main(void){ return 0; }', price: 150, reward: 300, hint: null, answerData: { type: 'WILL_IT_COMPILE', matchMode: 'NORMALIZED', accepted: ['yes'] } },
    ];
    for (const q of questions) {
      const { status, data } = await apiJson('/host/questions', { method: 'POST', token: hostToken, body: q });
      if (status !== 200 && status !== 201) throw new Error(`add ${q.code} → ${status}: ${JSON.stringify(data)}`);
    }
    const { status, data } = await apiJson('/host/state', { token: hostToken });
    if (status !== 200) throw new Error(`host state → ${status}`);
  });

  // Player 1 joins through the real UI, capturing the REAL team token
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
    await p1.fill('input#teamName', 'Solve Team');
    await p1.fill('input#p1', 'Ada');
    await p1.fill('input#p2', 'Grace');
    await p1.click('button:has-text("JOIN GAME")');
    await waitWallet(p1, '1,000');
    if (!tokenFromResp) throw new Error('team token not captured from join response');
    teamToken = tokenFromResp;
  });

  // Player 2 joins the SAME team via join-existing
  await check('Player 2 joins SAME team via join-existing', async () => {
    p2ctx = await browser.newContext();
    p2 = await p2ctx.newPage();
    await p2.goto(`${BASE}/join-existing`);
    await p2.fill('input#code', gameCode);
    await p2.fill('input#token', teamToken);
    await p2.click('button:has-text("REJOIN TEAM")');
    await waitWallet(p2, '1,000');
  });

  // Both seats present
  await check('Two-seat presence sync both clients', async () => {
    await p1.waitForSelector('text=2/2 players connected', { timeout: 15000 });
    await p2.waitForSelector('text=2/2 players connected', { timeout: 15000 });
  });

  // Host starts the game (real API; host console UI not wired yet) → MARKET_OPEN
  await check('Host starts game (API) → MARKET_OPEN', async () => {
    const { status } = await apiJson('/host/start', { method: 'POST', token: hostToken });
    if (status !== 200) throw new Error(`start → ${status}`);
  });

  // Player 1 buys S01 through the real UI
  await check('Player 1 buys S01 (100) through UI', async () => {
    await gotoPage(p1, '/team/market');
    await p1.waitForFunction(
      () => !!Array.from(document.querySelectorAll('button')).find((b) => b.innerText.trim() === 'BUY'),
      undefined,
      { timeout: 15000 },
    );
    await p1.locator(`div.rounded-xl:has-text("S01") button:has-text("BUY")`).first().click();
    await p1.waitForSelector('[role="status"]:has-text("Purchased!")', { timeout: 10000 });
    await waitWallet(p1, '900');
  });

  // S01 appears in inventory (UNSOLVED)
  await check('S01 appears in Player 1 inventory (UNSOLVED)', async () => {
    await gotoPage(p1, '/team/inventory');
    if ((await inventoryCount(p1)) !== 1) throw new Error('inventory count mismatch');
    if (!(await ownsCodeWithStatus(p1, 'S01', 'UNSOLVED'))) throw new Error('S01 not UNSOLVED in inventory');
  });

  // Buy also reflected on seat 2
  await check('Purchase of S01 reflected on Player 2', async () => {
    await waitWallet(p2, '900');
    await gotoPage(p2, '/team/inventory');
    if (!(await ownsCodeWithStatus(p2, 'S01', 'UNSOLVED'))) throw new Error('P2 does not see S01 UNSOLVED');
  });

  // Resolve the S01 question id from authoritative team state (the submit
  // contract is keyed on the QUESTION id, matching /team/questions/:qid/*)
  let s01QuestionId = '';
  await check('Resolve S01 question id from team state (API)', async () => {
    const { status, data } = await apiJson('/team/state', { token: teamToken });
    if (status !== 200) throw new Error(`team state → ${status}`);
    const owned = data.inventory?.find((i) => i.question.code === 'S01');
    if (!owned) throw new Error('S01 not in inventory');
    s01QuestionId = owned.question.id;
  });

  // Player 1 opens the Solve screen and sees the question details
  await check('Player 1 opens Solve for S01 and sees question details', async () => {
    await gotoPage(p1, `/team/solve/${s01QuestionId}`);
    await p1.waitForSelector(`text=S01`, { timeout: 15000 });
    const body = await p1.locator('body').innerText();
    for (const frag of ['EASY', 'WILL IT COMPILE', 'S one compiles?', 'Will this C program compile?', '200']) {
      if (!body.includes(frag)) throw new Error(`Solve page missing "${frag}"`);
    }
    await p1.waitForSelector('button:has-text("SUBMIT")', { timeout: 10000 });
  });

  // Player 1 submits the correct answer → ACCEPTED, +200, balance 1,100
  await check('Player 1 submits correct answer → ACCEPTED (S01)', async () => {
    await p1.fill('input#answer', 'yes');
    await p1.click('button:has-text("SUBMIT")');
    await p1.waitForSelector('[role="status"]:has-text("ACCEPTED")', { timeout: 15000 });
    await waitWallet(p1, '1,100');
  });

  // Reward persisted + score/solved updated on the leaderboard state
  await check('Reward + score persisted in authoritative team state', async () => {
    const { status, data } = await apiJson('/team/state', { token: teamToken });
    if (status !== 200) throw new Error(`team state → ${status}`);
    if (data.team.coins !== 1100) throw new Error(`coins=${data.team.coins} want 1100`);
    if (data.team.solvedCount !== 1) throw new Error(`solvedCount=${data.team.solvedCount}`);
    if (data.team.score <= 0) throw new Error(`score=${data.team.score} should be > 0`);
    const s01 = data.inventory.find((i) => i.question.code === 'S01');
    if (s01?.status !== 'SOLVED') throw new Error(`S01 status=${s01?.status} want SOLVED`);
  });

  // S01 shows SOLVED in Player 1 inventory
  await check('S01 shows SOLVED in Player 1 inventory', async () => {
    await gotoPage(p1, '/team/inventory');
    if (!(await ownsCodeWithStatus(p1, 'S01', 'SOLVED'))) throw new Error('S01 not SOLVED on P1');
  });

  // Player 2 converges on the SAME authoritative state
  await check('Player 2 converges: wallet 1,100 + S01 SOLVED', async () => {
    await waitWallet(p2, '1,100');
    await gotoPage(p2, '/team/inventory');
    if (!(await ownsCodeWithStatus(p2, 'S01', 'SOLVED'))) throw new Error('S01 not SOLVED on P2');
  });

  // Duplicate submission protection: S01 is now disabled (already solved)
  await check('Re-opening solved S01 disables SUBMIT (already solved)', async () => {
    await gotoPage(p2, `/team/solve/${s01QuestionId}`);
    await p2.waitForSelector('button:has-text("SUBMIT")', { timeout: 10000 });
    await p2.waitForTimeout(600); // let state:sync land so status is SOLVED
    const disabled = await p2.locator('button:has-text("SUBMIT")').isDisabled();
    if (!disabled) throw new Error('SUBMIT not disabled for solved question');
    const body = await p2.locator('body').innerText();
    if (!body.toLowerCase().includes('already solved')) throw new Error('missing already-solved note');
  });

  // Direct re-submit of a solved question via API → 409 CONFLICT (backend authority)
  await check('Direct re-submit of solved S01 rejected (409 CONFLICT)', async () => {
    const { status, data } = await apiJson(`/team/questions/${s01QuestionId}/submit`, {
      method: 'POST',
      token: teamToken,
      body: { idempotencyKey: `e2e-resub-${Date.now().toString(36)}`, answer: { kind: 'free', text: 'yes' } },
    });
    if (status !== 409) throw new Error(`expected 409 got ${status}: ${JSON.stringify(data)}`);
  });

  // ─────────────────────────────────────────────────────────────────────
  // WRONG ANSWER PATH — Player 1 buys S02 (150) and answers incorrectly
  // ─────────────────────────────────────────────────────────────────────
  await check('Player 1 buys S02 (150) through UI', async () => {
    await gotoPage(p1, '/team/market');
    await p1.waitForFunction(
      () => !!Array.from(document.querySelectorAll('button')).find((b) => b.innerText.trim() === 'BUY'),
      undefined,
      { timeout: 15000 },
    );
    await p1.locator(`div.rounded-xl:has-text("S02") button:has-text("BUY")`).first().click();
    await p1.waitForSelector('[role="status"]:has-text("Purchased!")', { timeout: 10000 });
    await waitWallet(p1, '950');
  });

  let s02QuestionId = '';
  await check('Resolve S02 question id from team state (API)', async () => {
    const { status, data } = await apiJson('/team/state', { token: teamToken });
    if (status !== 200) throw new Error(`team state → ${status}`);
    const owned = data.inventory?.find((i) => i.question.code === 'S02');
    if (!owned) throw new Error('S02 not in inventory');
    s02QuestionId = owned.question.id;
  });

  await check('Player 1 submits wrong answer → REJECTED, no reward', async () => {
    await gotoPage(p1, `/team/solve/${s02QuestionId}`);
    await p1.fill('input#answer', 'no');
    await p1.click('button:has-text("SUBMIT")');
    await p1.waitForSelector('[role="status"]:has-text("REJECTED")', { timeout: 15000 });
    await waitWallet(p1, '950'); // unchanged, never negative
  });

  await check('Wrong answer marks S02 FAILED in inventory (no attempts left)', async () => {
    await gotoPage(p1, '/team/inventory');
    if (!(await ownsCodeWithStatus(p1, 'S02', 'FAILED'))) throw new Error('S02 not FAILED on P1');
    const { status, data } = await apiJson('/team/state', { token: teamToken });
    if (status !== 200) throw new Error(`team state → ${status}`);
    if (data.team.coins !== 950) throw new Error(`coins=${data.team.coins} want 950`);
    const s02 = data.inventory.find((i) => i.question.code === 'S02');
    if (s02?.status !== 'FAILED') throw new Error(`S02 status=${s02?.status} want FAILED`);
  });

  // Player 2 sees the FAILED + wallet sync
  await check('Player 2 converges: wallet 950 + S02 FAILED', async () => {
    await waitWallet(p2, '950');
    await gotoPage(p2, '/team/inventory');
    if (!(await ownsCodeWithStatus(p2, 'S02', 'FAILED'))) throw new Error('S02 not FAILED on P2');
  });

  await p1ctx?.close?.().catch(() => {});
  await p2ctx?.close?.().catch(() => {});
  await browser.close();

  console.log('\n===== STEP 4 SOLVE-FLOW RUNTIME VERIFICATION =====');
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
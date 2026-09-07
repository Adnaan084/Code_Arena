/**
 * H1 Host dashboard — end-to-end smoke verification.
 *
 * Real browser + real backend. A host creates a game through the real UI, lands
 * on the host console, and — driven by the real host REST endpoints exactly as
 * the UI will one day — registers a team (via the real join UI) and starts the
 * game. Every assertion reads the SERVER-AUTHORITATIVE state that the host
 * socket delivers (state:sync / time:sync / game:event), never fake state.
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

const bodyText = (page) => page.locator('body').innerText();

const waitForBody = (page, text, timeout = 20000) =>
  page.waitForFunction((t) => document.body.innerText.includes(t), text, { timeout });

const waitForRegex = (page, pattern, timeout = 20000) =>
  page.waitForFunction(
    (src) => new RegExp(src).test(document.body.innerText),
    pattern.source,
    { timeout },
  );

const readSeq = async (page) => {
  const body = await bodyText(page);
  const m = /SEQ (\d+)/.exec(body);
  return m ? parseInt(m[1], 10) : -1;
};

const readTimer = async (page) => {
  const loc = page.locator('[title="Phase countdown (server-authoritative)"]');
  return (await loc.count()) ? (await loc.innerText()).trim() : null;
};

async function main() {
  const browser = await chromium.launch({ headless: true });
  let gameCode = '';
  let hostToken = '';

  // ─────────────────────────────────────────────────────────────────────
  // AUTH — /host without a session must refuse to show a console
  // ─────────────────────────────────────────────────────────────────────
  await check('Host auth: /host without a session shows NO HOST SESSION', async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${BASE}/host`);
    await page.waitForSelector('text=NO HOST SESSION', { timeout: 15000 });
    await page.waitForSelector('button:has-text("CREATE HOST GAME")', { timeout: 10000 });
    await ctx.close();
  });

  // ─────────────────────────────────────────────────────────────────────
  // AUTH — create a game through the real UI → host session established
  // ─────────────────────────────────────────────────────────────────────
  await check('Host creates game (real UI) and opens the console', async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    // The app persists the host TOKEN (a credential — authoritative game state
    // is never stored); a hard reload of /host must restore the session and
    // pull state back over the socket. This is the real host re-open flow.
    await page.goto(`${BASE}/create`);
    await page.fill('input#title', 'E2E Host Dashboard');
    await page.click('button:has-text("CREATE GAME")');
    await page.waitForSelector('text=GAME CREATED', { timeout: 15000 });
    const body = await page.locator('body').innerText();
    const code = /GAME CODE\s*\n([A-Z0-9]{4,8})/.exec(body)?.[1];
    const token = /([0-9a-f]{64})/.exec(body)?.[1];
    if (!code || !token) throw new Error(`could not parse code/token:\n${body}`);
    gameCode = code;
    hostToken = token;

    await page.goto(`${BASE}/host`);
    await page.waitForSelector('[title="Phase countdown (server-authoritative)"]', { timeout: 20000 });
    await page.waitForSelector('text=LOBBY', { timeout: 10000 });
    globalThis.__hostPage = page;
    globalThis.__hostCtx = ctx;
  });

  const page = globalThis.__hostPage;

  // ─────────────────────────────────────────────────────────────────────
  // DASHBOARD — authoritative game info appears (nothing from localStorage)
  // ─────────────────────────────────────────────────────────────────────
  await check('Dashboard loads: game code + LOBBY phase + live seq', async () => {
    await waitForBody(page, gameCode);
    await waitForBody(page, 'LOBBY');
    await waitForBody(page, 'LIVE · SEQ');
    await waitForBody(page, 'START —');     // no start/end yet — contract says null
    await waitForBody(page, 'DURATION 30 min');
  });

  await check('Dashboard: capacity 0/40, registered 0, no activity yet', async () => {
    await waitForRegex(page, /REGISTERED\s*\n0/);
    await waitForRegex(page, /0\/40/);
    await waitForRegex(page, /CONNECTED\s*\n0/);
    await waitForBody(page, 'MARKET PRE-GAME');
  });

  await check('Dashboard: pre-game countdown is placeholder (server has no timer yet)', async () => {
    const t = await readTimer(page);
    if (t !== '--:--') throw new Error(`pre-game timer = ${t} (want --:--)`);
  });

  // ─────────────────────────────────────────────────────────────────────
  // TEAMS — join a real team through the real UI → live presence on the
  // dashboard via team:presence (authoritative connected count)
  // ─────────────────────────────────────────────────────────────────────
  let teamCtx;
  await check('Team joins through the real UI (registered 1)', async () => {
    teamCtx = await browser.newContext();
    const t = await teamCtx.newPage();
    await t.goto(`${BASE}/join`);
    await t.fill('input#code', gameCode);
    await t.fill('input#teamName', 'E2E Team Alpha');
    await t.fill('input#p1', 'AlphaOne');
    await t.fill('input#p2', 'AlphaTwo');
    await t.click('button:has-text("JOIN GAME")');
    // Wallet = 1,000 confirms state:sync landed over a live team socket, which
    // also emits team:presence to the host room (deterministic connected count).
    await t.waitForFunction(
      (v) => {
        const el = document.querySelector('[title="Team coins (server-authoritative)"] span');
        return el && el.innerText.trim() === v;
      },
      '1,000',
      { timeout: 20000 },
    );
    globalThis.__teamPage = t;
  });

  await check('Dashboard updates to registered 1 → capacity 1/40', async () => {
    await waitForRegex(page, /1\/40/);
    await waitForRegex(page, /REGISTERED\s*\n1/);
  });

  await check('Dashboard: real team socket presence → connected 1, offline 1', async () => {
    await waitForRegex(page, /CONNECTED\s*\n1/);
    await waitForRegex(page, /OFFLINE\s*\n1/);
  });

  await check('Dashboard economy: INITIAL transaction recorded (1)', async () => {
    await waitForRegex(page, /TRANSACTIONS\s*\n[1-9]/);
  });

  // ─────────────────────────────────────────────────────────────────────
  // REALTIME — a real game event (host start) updates the dashboard via
  // game:event + time:sync + state:sync — phase flips and timer counts down
  // ─────────────────────────────────────────────────────────────────────
  await check('Host starts game via real API → dashboard shows MARKET OPEN', async () => {
    const before = await readSeq(page);
    const res = await apiJson('/host/start', { method: 'POST', token: hostToken });
    if (res.status !== 200) throw new Error(`start → ${res.status}`);
    const st = await apiJson('/host/state', { token: hostToken });
    if (st.data?.meta?.state !== 'MARKET_OPEN') throw new Error(`server state=${st.data?.meta?.state}`);
    await waitForBody(page, 'MARKET OPEN', 15000);      // phase label
    await waitForBody(page, 'TRADING OPEN');            // derived rules chip
    // a real game:event landed (GAME_STARTED) → seq moved forward
    await page.waitForFunction((b) => { const m = /SEQ (\d+)/.exec(document.body.innerText); return m && parseInt(m[1], 10) > b; }, before, { timeout: 15000 });
  });

  await check('Dashboard: authoritative countdown appears (mm:ss digits)', async () => {
    await page.waitForFunction(
      () => /^\d{2}:\d{2}$/.test((document.querySelector('[title="Phase countdown (server-authoritative)"]')?.textContent ?? '').trim()),
      undefined,
      { timeout: 15000 },
    );
    const t = await readTimer(page);
    if (!/^\d{2}:\d{2}$/.test(t ?? '')) throw new Error(`timer = ${t} (want mm:ss)`);
    await waitForRegex(page, /START \d{1,2}:\d{2}:\d{2}/);
  });

  await check('Dashboard: activity feed updates on a real game:event (host announcement)', async () => {
    const msg = `Host announcement ${Date.now()}`;
    const res = await apiJson('/host/announcements', { method: 'POST', token: hostToken, body: { message: msg } });
    if (res.status !== 201 && res.status !== 200) throw new Error(`announce → ${res.status}`);
    await waitForBody(page, msg, 15000); // message text appears in RECENT ACTIVITY
  });

  // ─────────────────────────────────────────────────────────────────────
  // RECONNECT — authoritative state returns via socket after a reload,
  // never from localStorage game state
  // ─────────────────────────────────────────────────────────────────────
  await check('Dashboard: reload returns authoritative MARKET OPEN via socket', async () => {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[title="Phase countdown (server-authoritative)"]', { timeout: 20000 });
    await waitForBody(page, 'MARKET OPEN', 15000);
    await waitForBody(page, 'TRADING OPEN');
    // first time:sync after reconnect re-anchors the countdown within ~1 s
    await page.waitForFunction(
      () => /^\d{2}:\d{2}$/.test((document.querySelector('[title="Phase countdown (server-authoritative)"]')?.textContent ?? '').trim()),
      undefined,
      { timeout: 15000 },
    );
    const t = await readTimer(page);
    if (!/^\d{2}:\d{2}$/.test(t ?? '')) throw new Error(`post-reload timer = ${t} (want mm:ss)`);
  });

  // ─────────────────────────────────────────────────────────────────────
  // H2-A LIFECYCLE — every lifecycle control is driven through the REAL
  // host console buttons + confirm modal, and every assertion reads the
  // SERVER-AUTHORITATIVE state (meta.state via /host/state + the dashboard
  // that the host socket keeps in sync). No fake/local state.
  // ─────────────────────────────────────────────────────────────────────
  const toolbarBtn = (label) => page.locator(`button:has-text("${label}")`).first();
  const dialogConfirm = (label) => page.locator(`[role="dialog"] button:has-text("${label}")`).first();
  const readState = async () => (await apiJson('/host/state', { token: hostToken })).data?.meta?.state;
  const expectState = async (want, what) => {
    const got = await readState();
    if (got !== want) throw new Error(`${what}: server meta.state = ${got} (want ${want})`);
  };

  await check('H2: lifecycle buttons respect the current phase (before actions)', async () => {
    // Still MARKET OPEN after the reload check above.
    if (!(await toolbarBtn('START').isDisabled())) throw new Error('START should be disabled while in play');
    if (!(await toolbarBtn('RESUME').isDisabled())) throw new Error('RESUME should be disabled while not paused');
    if (!(await toolbarBtn('RESET ROUND').isDisabled())) throw new Error('RESET ROUND should be disabled before COMPLETED');
    if (await toolbarBtn('CLOSE MARKET').isDisabled()) throw new Error('CLOSE MARKET should be enabled while in play');
    if (await toolbarBtn('END GAME').isDisabled()) throw new Error('END GAME should be enabled while in play');
  });

  await check('H2: PAUSE button freezes the game (dashboard + server say PAUSED)', async () => {
    await toolbarBtn('PAUSE').click();
    await waitForBody(page, 'PAUSED', 15000);
    await waitForRegex(page, /MARKET PAUSED/);
    await expectState('PAUSED', 'after pause');
    // Pause is a real lifecycle event → phase label flips and RESUME unlocks.
    if (await toolbarBtn('RESUME').isDisabled()) throw new Error('RESUME should be enabled while paused');
  });

  await check('H2: RESUME button resumes the game — clock authority returns to MARKET OPEN', async () => {
    await toolbarBtn('RESUME').click();
    await waitForBody(page, 'MARKET OPEN', 15000);
    await waitForRegex(page, /TRADING OPEN/);
    await expectState('MARKET_OPEN', 'after resume');
  });

  await check('H2: CLOSE MARKET opens a confirm dialog; confirming freezes the market', async () => {
    await toolbarBtn('CLOSE MARKET').click();
    await page.waitForSelector('[role="dialog"]', { timeout: 10000 });
    await page.waitForFunction(() => /CLOSE MARKET\?/.test(document.body.innerText), undefined, { timeout: 10000 });
    await dialogConfirm('CLOSE MARKET').click();
    await waitForBody(page, 'MARKET CLOSED', 15000);
    await waitForRegex(page, /TRADING CLOSED/);
    await expectState('MARKET_CLOSED', 'after close-market');
    if (await toolbarBtn('END GAME').isDisabled()) throw new Error('END GAME should be enabled after market close');
  });

  await check('H2: END GAME confirm dialog — confirming locks the game as COMPLETED', async () => {
    await toolbarBtn('END GAME').click();
    await page.waitForSelector('[role="dialog"]', { timeout: 10000 });
    await page.waitForFunction(() => /END GAME\?/.test(document.body.innerText), undefined, { timeout: 10000 });
    await dialogConfirm('END GAME').click();
    await waitForBody(page, 'COMPLETED', 15000);
    await expectState('COMPLETED', 'after finalize');
    if (await toolbarBtn('RESET ROUND').isDisabled()) throw new Error('RESET ROUND should be enabled once COMPLETED');
  });

  await check('H2: RESET ROUND confirm dialog — confirming returns the game to a clean LOBBY', async () => {
    await toolbarBtn('RESET ROUND').click();
    await page.waitForSelector('[role="dialog"]', { timeout: 10000 });
    await page.waitForFunction(() => /RESET GAME\?/.test(document.body.innerText), undefined, { timeout: 10000 });
    await dialogConfirm('RESET GAME').click();
    await waitForBody(page, 'LOBBY', 15000);
    await waitForRegex(page, /MARKET PRE-GAME/);
    await expectState('LOBBY', 'after reset');
    if (await toolbarBtn('START').isDisabled()) throw new Error('START should be enabled again after reset');
  });

  // ─────────────────────────────────────────────────────────────────────
  // H2-B TEAM ADMIN + ECONOMY — every control is driven through the REAL
  // Host Console "Team Administration" section + its confirmation modals,
  // and every assertion reads the server-authoritative /host/state snapshot
  // (team status, balances, purchases). No fake/local state.
  // ─────────────────────────────────────────────────────────────────────
  const readTeam = async () => {
    const { status, data } = await apiJson('/host/state', { token: hostToken });
    if (status !== 200) throw new Error(`host/state → ${status}`);
    return (data?.teams ?? []).find((t) => t.name === 'E2E Team Alpha') ?? null;
  };
  const readPurchases = async () => {
    const { data } = await apiJson('/host/state', { token: hostToken });
    return data?.purchases ?? [];
  };
  const rowButton = (label) => page.locator(`button:has-text("${label}")`).first();

  await check('H2-B: team administration section lists the team (ACTIVE + BAL 1,000)', async () => {
    await waitForBody(page, 'TEAM ADMINISTRATION');
    await waitForBody(page, 'E2E Team Alpha', 15000);
    if ((await rowButton('DISQUALIFY').count()) === 0) throw new Error('DISQUALIFY control missing for ACTIVE team');
    const b = await readTeam();
    if (!b || b.status !== 'ACTIVE' || b.coins !== 1000) throw new Error(`team = ${JSON.stringify(b)}`);
  });

  await check('H2-B: canceling the DISQUALIFY dialog performs no action', async () => {
    await rowButton('DISQUALIFY').click();
    await page.waitForSelector('[role="dialog"]', { timeout: 10000 });
    await waitForBody(page, 'DISQUALIFY TEAM?', 10000);
    await page.locator('[role="dialog"] button:has-text("CANCEL")').click();
    await page.waitForSelector('[role="dialog"]', { state: 'detached', timeout: 8000 }).catch(() => {});
    const b = await readTeam();
    if (!b || b.status !== 'ACTIVE' || b.coins !== 1000) throw new Error(`team after cancel = ${JSON.stringify(b)}`);
  });

  await check('H2-B: confirming DISQUALIFY marks the team DISQUALIFIED (server-authoritative)', async () => {
    await rowButton('DISQUALIFY').click();
    await page.waitForSelector('[role="dialog"]', { timeout: 10000 });
    await waitForBody(page, 'DISQUALIFY TEAM?', 10000);
    await dialogConfirm('DISQUALIFY').click();
    // Modal closes on success (result.ok) and the store resyncs; wait for the
    // row to flip from DISQUALIFY → REINSTATE rather than matching the modal
    // description text ("The team is marked DISQUALIFIED…") which would pass
    // before the store update lands.
    await page.waitForSelector('button:has-text("REINSTATE")', { timeout: 15000 });
    const b = await readTeam();
    if (!b || b.status !== 'DISQUALIFIED') throw new Error(`team = ${JSON.stringify(b)}`);
    if (b.coins !== 1000) throw new Error('disqualify changed the balance');
  });

  await check('H2-B: REINSTATE returns the team to ACTIVE and restores participation', async () => {
    await rowButton('REINSTATE').click();
    await page.waitForSelector('button:has-text("DISQUALIFY")', { timeout: 15000 });
    const b = await readTeam();
    if (!b || b.status !== 'ACTIVE' || b.coins !== 1000) throw new Error(`team = ${JSON.stringify(b)}`);
  });

  await check('H2-B: ADD COINS through the confirm modal → authoritative balance 1,250', async () => {
    await rowButton('ADD COINS').click();
    await page.waitForSelector('[role="dialog"]', { timeout: 10000 });
    await waitForBody(page, 'ADD COINS', 10000);
    await page.fill('input#coin-amount', '250');
    await page.fill('input#coin-reason', 'E2E head start');
    await dialogConfirm('ADD COINS').click();
    await waitForBody(page, 'BAL 1,250', 15000);
    const b = await readTeam();
    if (!b || b.coins !== 1250) throw new Error(`coins = ${b?.coins}`);
  });

  await check('H2-B: REMOVE COINS through the confirm modal → authoritative balance 900', async () => {
    await rowButton('REMOVE COINS').click();
    await page.waitForSelector('[role="dialog"]', { timeout: 10000 });
    await waitForBody(page, 'REMOVE COINS', 10000);
    await page.fill('input#coin-amount', '350');
    await page.fill('input#coin-reason', 'E2E entry fee');
    await dialogConfirm('REMOVE COINS').click();
    await waitForBody(page, 'BAL 900', 15000);
    const b = await readTeam();
    if (!b || b.coins !== 900) throw new Error(`coins = ${b?.coins}`);
  });

  await check('H2-B: invalid coin input (zero) disables the confirm button', async () => {
    await rowButton('REMOVE COINS').click();
    await page.waitForSelector('[role="dialog"]', { timeout: 10000 });
    await page.fill('input#coin-amount', '0');
    await page.fill('input#coin-reason', 'E2E invalid');
    if (!(await dialogConfirm('REMOVE COINS').isDisabled())) throw new Error('confirm should be disabled for amount 0');
    await page.locator('[role="dialog"] button:has-text("CANCEL")').click();
    await page.waitForSelector('[role="dialog"]', { state: 'detached', timeout: 8000 }).catch(() => {});
    const b = await readTeam();
    if (b?.coins !== 900) throw new Error(`coins changed = ${b?.coins}`);
  });

  await check('H2-B: server rejects an oversized removal and surfaces the error toast', async () => {
    await rowButton('REMOVE COINS').click();
    await page.waitForSelector('[role="dialog"]', { timeout: 10000 });
    await page.fill('input#coin-amount', '999999');
    await page.fill('input#coin-reason', 'E2E too much');
    await dialogConfirm('REMOVE COINS').click();
    await waitForBody(page, 'Could not adjust coins', 15000);
    // Modal stays open on failure so the host can retry/cancel; balance untouched.
    if ((await page.locator('[role="dialog"]').count()) === 0) throw new Error('modal closed after failed adjustment');
    await page.locator('[role="dialog"] button:has-text("CANCEL")').click();
    await page.waitForSelector('[role="dialog"]', { state: 'detached', timeout: 8000 }).catch(() => {});
    const b = await readTeam();
    if (b?.coins !== 900) throw new Error(`coins changed after rejection = ${b?.coins}`);
  });

  // ── Refund setup: seed one question, restart the game, buy via the real team UI ──
  await check('H2-B: setup — seed question + start game (API)', async () => {
    const q = {
      code: 'H2BQ1', type: 'MULTIPLE_CHOICE', difficulty: 'EASY', category: 'C SYNTAX',
      title: 'Refund target', body: 'one', price: 100, reward: 200,
      answerData: { type: 'MULTIPLE_CHOICE', options: ['a', 'b'], correctIndex: 0 },
    };
    const add = await apiJson('/host/questions', { method: 'POST', token: hostToken, body: q });
    if (add.status !== 201 && add.status !== 200) throw new Error(`add question → ${add.status}`);
    const st = await apiJson('/host/start', { method: 'POST', token: hostToken });
    if (st.status !== 200) throw new Error(`start → ${st.status}`);
    const s = await apiJson('/host/state', { token: hostToken });
    if (s.data?.meta?.state !== 'MARKET_OPEN') throw new Error(`state=${s.data?.meta?.state}`);
  });

  await check('H2-B: setup — team buys the question through the real UI (BAL 800)', async () => {
    const t = globalThis.__teamPage;
    await t.goto(`${BASE}/team/market`);
    await t.waitForSelector('[title="Team coins (server-authoritative)"] span', { timeout: 25000 });
    await t.waitForFunction(() => document.body.innerText.includes('H2BQ1'), undefined, { timeout: 20000 });
    await t.locator(`div.rounded-xl:has-text("H2BQ1") button:has-text("BUY")`).first().click();
    await t.waitForFunction(
      (v) => { const el = document.querySelector('[title="Team coins (server-authoritative)"] span'); return el && el.innerText.trim() === v; },
      '800',
      { timeout: 25000 },
    );
    const own = (await readPurchases()).find((p) => p.questionCode === 'H2BQ1');
    if (!own) throw new Error('purchase not visible on host refund surface');
  });

  await check('H2-B: REFUND identifies the purchase in the modal and restores the balance', async () => {
    // Wait for the purchase to appear on the host refund surface (authoritative state)
    await page.waitForFunction(
      async (token) => {
        const res = await fetch(`/api/host/state`, { headers: { Authorization: `Bearer ${token}` } });
        const data = await res.json().catch(() => null);
        return (data?.purchases ?? []).some((p) => p.questionCode === 'H2BQ1' && p.status === 'UNSOLVED');
      },
      hostToken,
      { timeout: 20000 },
    );
    const own = (await readPurchases()).find((p) => p.questionCode === 'H2BQ1');
    if (!own) throw new Error('purchase missing before refund');
    // Wait for the REFUND button to exist and be enabled (the team row has it).
    const refundBtn = page.locator('button:has-text("REFUND")').first();
    await refundBtn.waitFor({ state: 'visible', timeout: 10000 });
    if (await refundBtn.isDisabled()) throw new Error('REFUND button disabled');
    await refundBtn.click();
    await page.waitForSelector('[role="dialog"]', { timeout: 10000 });
    await waitForBody(page, 'REFUND PURCHASE?', 10000);
    // Deterministic app condition: the host store must have received the purchase
    // over its authoritative state:sync before the dropdown can offer it. Waiting
    // on the option (not a fixed delay) makes the flow converge regardless of
    // whether the post-buy resync beats the modal render. `attached` (not the
    // default `visible`) because a <option> inside a closed <select> is never
    // considered visible by Playwright.
    await page.waitForSelector(`#refund-pick option[value="${own.questionId}"]`, { state: 'attached', timeout: 15000 });
    await page.selectOption('#refund-pick', own.questionId);
    await page.fill('input#refund-reason', 'duplicate purchase');
    await dialogConfirm('REFUND').click();
    await waitForBody(page, 'BAL 900', 15000); // 800 + 100 price restored
    const b = await readTeam();
    if (!b || b.coins !== 900) throw new Error(`coins after refund = ${b?.coins}`);
    if ((await readPurchases()).some((p) => p.questionCode === 'H2BQ1')) throw new Error('purchase still present after refund');
  });

  await globalThis.__teamPage?.context?.close?.().catch(() => {});
  await globalThis.__hostCtx?.close?.().catch(() => {});
  await browser.close();

  // ─────────────────────────────────────────────────────────────────────
  console.log('\n===== H1 HOST DASHBOARD + H2-A LIFECYCLE + H2-B TEAM/ECONOMY E2E =====');
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
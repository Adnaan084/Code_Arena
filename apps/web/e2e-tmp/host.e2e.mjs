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

  await globalThis.__teamPage?.context?.close?.().catch(() => {});
  await globalThis.__hostCtx?.close?.().catch(() => {});
  await browser.close();

  // ─────────────────────────────────────────────────────────────────────
  console.log('\n===== H1 HOST DASHBOARD E2E =====');
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
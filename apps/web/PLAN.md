
# Will It Compile? — Web frontend plan

Live multiplayer C-programming marketplace game for a campus event: **40 teams × 2 players = 80 simultaneous players**. Consumes the committed backend (`apps/server`) over its REST + Socket.IO contracts. **The backend is authoritative** — the UI renders server state, never computes balances/scores, and never duplicates grading/pricing rules.

## Stack (locked in Phase A step 1)

React 19 · TypeScript (strict, `noUncheckedIndexedAccess`) · Vite 6 · Tailwind v4 (`@tailwindcss/vite`) · Zustand 5 · socket.io-client 4 · react-router-dom 6 · lucide-react. Shared types/config imported from `@wcc/shared` (source alias in `vite.config.ts`).

## Endpoints consumed (from `apps/server`, verified against committed code)

- **Auth**: `Authorization: Bearer <token>`. Team token from `POST /api/public/games/:code/teams/join`; second player re-attaches via `join-existing`. Host token from `POST /api/public/games`.
- **Team** (`/api/team`): `state`, `questions/:qid/purchase {idempotencyKey}`, `questions/:qid/submit {idempotencyKey,answer}`, `trades` CRUD, `transactions`, `leaderboard`, `marketplace`, `inventory`.
- **Host** (`/api/host`): `state`, `start|pause|resume|close-market|finalize|reset|force-close`, `teams`, `questions` CRUD/import/export, `coins/adjust`, `announcements`, `config`, `leaderboard`, `audit`, `transactions`, `activity`.
- **Display** (`/api/display`): `GET /:code`, `GET /:code/events?sinceSeq`.
- **Errors**: envelope `{ error: { code, message, details? } }`; see `ERRORS.md` mapping to human text.

## Socket.IO (server emits)

`state:sync` (role-shaped: team/host/display), `time:sync {remainingMs,totalMs,state,phase}` (1s authoritative pulse), `game:event {type,t,questionCode?}` (domain events → triggers debounced `req:state` reconcile), `team:presence {teamId,name,online,connectedCount,disconnectedAt}` (team + host rooms), `error {code,message}`. Client→server: `req:state`. Reconnect always re-requests authoritative state and **replaces** local state (never trusts stale Zustand between reconnects).

## Directories (`apps/web/src`)

```
src/
  main.tsx                 boot: providers, router, socket bootstrap
  router.tsx               routes: / , /team, /host, /display/:gameCode
  index.css                Tailwind v4 theme tokens (dark, terminal-inspired, WIC)
  lib/                     api.ts (typed client + ApiError + error code→message),
                           socket.ts (connect/auth/rooms/reconnect/resync),
                           format.ts, idempotency.ts
  stores/                  auth, team(game), host, display, socket/connection, toasts, timer hook
  components/ui/           Button, Card, Badge, Stat, Modal, Toaster, CodeBlock, Spinner, Empty, PhaseBanner
  components/layout/       AppShell, TeamShell (tab bar), HostShell (desktop nav), DisplayShell (fullscreen)
  pages/
    Landing.tsx            join game / create game / join-existing seat
    team/  Lobby, Dashboard (Marketplace|Inventory|Trades|Leaderboard Tabs), Solve
    host/  Console, Lobby, Questions, Teams, Transactions, Audit
    display/ Projector.tsx
  hooks/                   useRemainingTime (server-anchored countdown), useSocketInit
```

## Phases

- **A foundation** — routing, theme, api/socket clients, stores, auth/session, shells, design primitives. (now)
- **B team** — join/lobby (2-player presence), wallet, marketplace, purchase, inventory.
- **C solve** — solving screen, submission + result UX, leaderboard, activity.
- **D trades** — trade center, create/accept/reject.
- **E host** — create game, controls, question mgmt, monitors, audit, end game.
- **F display** — 1920×1080 projector, uses display socket role.
- **G reconnect/errors/system check** — reconnect UX, error toasts, system-check screen.
- **H Playwright E2E**, **I load** (40 teams).

## Backend additions made for the frontend (smallest changes + tests)

1. **Socket `display` role** — projector gets live `state:sync`/`time:sync`/`game:event` like others; still REST-public.
2. **`team:presence` → team room + `connectedCount`** — partners see "1/2 connected".
3. **`GameMeta.playersPerTeam`** — seat totals for lobby presence UI.
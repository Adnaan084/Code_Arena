# Will It Compile?

Live multiplayer **C-programming marketplace game**: teams race to buy C
questions (spot-the-bug, predict output, will-it-compile, …), solve them before
rivals, and trade questions mid-game. Monorepo (npm workspaces):

```
packages/shared   – shared Zod schemas, game config, answer format types
apps/server       – Express 5 + Socket.IO API, Prisma/Postgres data layer
apps/web          – React frontend (in progress)
```

## Prerequisites

- Node.js **>= 20** (npm workspaces)
- Docker with Compose v2 (for Postgres)

## Quick start (server + DB)

```bash
# 1. Postgres via docker compose (publishes on host port 5433)
docker compose up -d
docker compose ps          # wait for "healthy"

# 2. Environment file (never committed; adjust values if needed)
copy .env.example apps/server/.env

# 3. Apply migrations to the dev database (and generate the client)
npm run db:migrate -w @wcc/server

# 4. Seed a throwaway demo game (code, host token, 2 teams, 20 questions)
npm run db:seed

# 5. Run the API (Express + Socket.IO on :4000, CORS to the Vite dev server)
npm run dev:server
```

`npm run dev` runs server + web with `concurrently`.

### Why host port 5433?

A native Windows PostgreSQL service often already listens on `0.0.0.0:5432`, and
connections to `localhost:5432` then land on *that* server instead of the
container — auth fails (Prisma `P1000`) even though the container credentials
are correct. The compose file publishes the container on **5433** to stay
unambiguous. If you have no native Postgres, you may switch back to `5432:5432`
and update `DATABASE_URL` accordingly.

## Databases

| Env var            | Default URL                                        | Purpose                          |
| ------------------ | -------------------------------------------------- | -------------------------------- |
| `DATABASE_URL`     | `postgresql://wcc:wcc_password@localhost:5433/wcc` | dev database (schema via migrate)|
| `TEST_DATABASE_URL`| `postgresql://wcc:wcc_password@localhost:5433/wcc_test` | separate DB for API smoke tests |

`wcc_test` is created automatically on first compose init
(`apps/server/docker/init-test-db.sql`) and must be migrated with:

```bash
TEST_DATABASE_URL=postgresql://wcc:wcc_password@localhost:5433/wcc_test \
  npx prisma migrate deploy -w @wcc/server   # from repo root
```

## Commands

```bash
npm run typecheck                  # tsc across all workspaces
npm run db:migrate -w @wcc/server  # prisma migrate dev
npm run db:seed  -w @wcc/server    # seed demo game
npm run test     -w @wcc/server    # vitest (includes API smoke tests)
npm run dev      -w @wcc/server    # tsx watch server
```

## Host & team authentication

- **Host**: one-time random token (256-bit) returned by `POST /api/public/games`;
  its SHA-256 is stored as `Game.hostTokenHash`. Send it as `X-Host-Token` to
  `/api/host/*`.
- **Team**: shared access token returned by
  `POST /api/public/games/:code/teams/join`; its SHA-256 is stored as
  `Team.accessTokenHash`. Send it as `X-Team-Token` to `/api/team/*`.

See `.env.example` for all supported environment variables.
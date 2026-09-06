/**
 * Test bootstrap (runs before every test file, in the same worker process).
 *
 * The app's Prisma singleton binds to `DATABASE_URL` at module-load, so this
 * file MUST run -- and point the DB at the separate wcc_test database --
 * before the test file imports ../src/app. Never point tests at the dev DB.
 */
import 'dotenv/config'; // loads apps/server/.env (holds TEST_DATABASE_URL)

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) {
  throw new Error('TEST_DATABASE_URL is not set. Copy .env.example to apps/server/.env and run `docker compose up -d`.');
}

process.env.DATABASE_URL = testUrl;
process.env.NODE_ENV = 'test';
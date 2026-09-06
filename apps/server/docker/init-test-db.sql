-- Runs once on first volume init (docker-entrypoint-initdb.d).
-- Creates the separate test database used by API/integration smoke tests
-- (see .env.example TEST_DATABASE_URL). No app schema here — migrations
-- create that for both wcc and wcc_test.
CREATE DATABASE wcc_test OWNER wcc;
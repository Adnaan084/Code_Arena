// Prisma config (Prisma 6.19+). Supersedes package.json#prisma.
// Prisma 6.19+ no longer auto-loads `.env` when a config file is present,
// so load it explicitly — DATABASE_URL lives in apps/server/.env.
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
});
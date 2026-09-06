/**
 * App factory: builds the Express + Socket.IO server WITHOUT listening.
 * index.ts (the process entry) calls createApp() then listen(); tests call
 * createApp() and drive it with supertest / a socket.io-client on an
 * ephemeral port. All data access flows through the Prisma singleton whose
 * DATABASE_URL is fixed at module-load — tests point it at the test DB by
 * setting process.env.DATABASE_URL in tests/setup.ts before importing.
 */
import express from 'express';
import { createServer } from 'http';
import helmet from 'helmet';
import cors from 'cors';
import { loadEnv, type Env } from './config/env';
import { errorHandler } from './middleware/errorHandler';
import { apiLimiter } from './middleware/ratelimit';
import { publicRouter } from './routes/public';
import { teamRouter } from './routes/team';
import { hostRouter } from './routes/host';
import { displayRouter } from './routes/display';
import { createSocketServer } from './sockets';

export interface AppBundle {
  app: express.Express;
  http: import('http').Server;
  socket: ReturnType<typeof createSocketServer>;
  env: Env;
}

export function createApp(): AppBundle {
  const env = loadEnv();
  const app = express();

  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: env.corsAll ? '*' : env.webOrigins, credentials: false }));
  app.use(express.json({ limit: '1mb' }));
  app.use(apiLimiter);

  app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString(), gameReady: true }));
  app.use('/api/public', publicRouter);
  app.use('/api/team', teamRouter);
  app.use('/api/host', hostRouter);
  app.use('/api/display', displayRouter);

  app.get('/api', (_req, res) => res.json({ name: 'Omnicore — Will It Compile?', version: '0.1.0' }));

  app.use(errorHandler);

  const http = createServer(app);
  const socket = createSocketServer(app, http);
  app.set('io', socket.handle);

  return { app, http, socket, env };
}
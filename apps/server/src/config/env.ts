/** Server environment config. All values come from env with safe defaults. */
export interface Env {
  port: number;
  webOrigins: string[];
  corsAll: boolean;
  tls: boolean;
  hostTokenBytes: number;
  logLevel: string;
  nodeEnv: string;
}

export function loadEnv(): Env {
  const port = Number(process.env.PORT ?? 4000);
  const originRaw = process.env.WEB_ORIGIN ?? 'http://localhost:5173';
  const corsAll = originRaw === '*';
  const webOrigins = originRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const hostTokenBytes = Number(process.env.HOST_TOKEN_BYTES ?? 32);
  return {
    port: Number.isFinite(port) && port > 0 ? port : 4000,
    webOrigins,
    corsAll,
    tls: process.env.TLS === 'true',
    hostTokenBytes: Number.isFinite(hostTokenBytes) && hostTokenBytes >= 16 ? hostTokenBytes : 32,
    logLevel: process.env.LOG_LEVEL ?? 'info',
    nodeEnv: process.env.NODE_ENV ?? 'development',
  };
}
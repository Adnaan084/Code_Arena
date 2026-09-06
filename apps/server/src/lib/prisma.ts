import { PrismaClient } from '@prisma/client';

/**
 * Default application client. Tests create their own PrismaClient pointed at
 * the test database and inject it via createApp(deps) instead of using this.
 */
export const prisma = new PrismaClient();

export type DB = PrismaClient;
/**
 * Interactive-transaction client — the exact shape of the client inside
 * $transaction. The transaction client omits the connection/transaction
 * management methods, so `Tx` must match that type for domain services that
 * accept either a top-level client or a transaction client.
 */
export type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'>;

/** Import this where you need the real client with all model delegates. */
export { prisma as db };
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** sha256 hex — token fingerprints stored at rest in place of raw tokens. */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Cryptographically random hex token. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}

/** Constant-time string comparison (digests are always 32 bytes → safe). */
export function safeEqual(a: string, b: string): boolean {
  const da = createHash('sha256').update(a).digest();
  const db = createHash('sha256').update(b).digest();
  return timingSafeEqual(da, db);
}

/** Server-assigned idempotency key for host/system actions that need one. */
export function newIdempotencyKey(): string {
  return `host-${randomBytes(12).toString('hex')}`;
}
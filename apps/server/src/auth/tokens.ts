/** Auth utilities: token hashing, extraction, role types. */
import { createHash } from 'node:crypto';
import type { Game, Team } from '@prisma/client';

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function extractBearer(req: { headers: { authorization?: string } }): string | null {
  const h = req.headers.authorization;
  if (!h) return null;
  const parts = h.split(' ');
  if (parts.length !== 2) return null;
  const scheme = parts[0] ?? '';
  const token = parts[1] ?? '';
  return scheme.toLowerCase() === 'bearer' && token ? token : null;
}

/** Result of resolving a host token. */
export interface HostAuth {
  game: Game;
}

/** Result of resolving a team token. */
export interface TeamAuth {
  game: Game;
  team: Team;
}

export type AuthResult = { ok: true; role: 'HOST'; host: HostAuth } | { ok: true; role: 'TEAM'; team: TeamAuth } | { ok: false; error: string };
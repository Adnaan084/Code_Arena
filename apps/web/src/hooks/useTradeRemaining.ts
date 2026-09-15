/**
 * H3 — Trade expiration countdown, anchored to the server-authoritative clock.
 *
 * The browser never reads Date.now() as a game clock. `time:sync` (pulsed every
 * second) carries `remainingMs`, from which — with the game's absolute `endTime`
 * — we derive the current server epoch. That anchor ticks locally between pulses
 * exactly like useRemainingTime, so the countdown:
 *   - never becomes negative (Math.max clamp)
 *   - reaches 00:00 safely
 *   - does not drift materially from server time (re-anchored every ~1s)
 *   - survives reconnect/resync (a fresh time:sync rebuilds the anchor)
 */
import { useEffect, useRef, useState } from 'react';
import { useClockStore } from '../stores/clock';
import { useHostStore } from '../stores/host';

export function useServerNowMs(): number | null {
  const remainingMs = useClockStore((s) => s.time?.remainingMs ?? null);
  const endTime = useHostStore((s) => s.meta?.endTime ?? null);
  const [now, setNow] = useState(() => Date.now());
  const anchor = useRef<{ at: number; serverNow: number } | null>(null);

  useEffect(() => {
    if (remainingMs === null || endTime === null) {
      anchor.current = null;
      return;
    }
    anchor.current = {
      at: Date.now(),
      serverNow: new Date(endTime).getTime() - remainingMs,
    };
  }, [remainingMs, endTime]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);

  const a = anchor.current;
  if (!a) return null;
  return a.serverNow + Math.max(0, now - a.at);
}

/** Remaining ms until `expiresAt` on the server clock (clamped ≥ 0). */
export function useTradeRemaining(expiresAt: string | null): number | null {
  const serverNow = useServerNowMs();
  if (serverNow === null || expiresAt === null) return null;
  return Math.max(0, new Date(expiresAt).getTime() - serverNow);
}
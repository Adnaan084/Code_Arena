import { useEffect, useRef, useState } from 'react';
import { useClockStore } from '../stores/clock';

/**
 * Local countdown derived from the authoritative `time:sync` value.
 *
 * The server is the only clock; the browser only renders it. We anchor to the
 * latest server value the moment it arrives, then tick locally. If the tab is
 * backgrounded (timers throttled) and resumes, the anchor math recomputes the
 * correct remaining time instantly instead of compounding drift.
 */
export function useRemainingTime(): number | null {
  const remaining = useClockStore((s) => s.time?.remainingMs ?? null);
  const [now, setNow] = useState(() => Date.now());
  const anchor = useRef<{ at: number; remaining: number } | null>(null);

  useEffect(() => {
    if (remaining === null) {
      anchor.current = null;
      return;
    }
    anchor.current = { at: Date.now(), remaining };
  }, [remaining]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);

  if (remaining === null) return null;
  const a = anchor.current;
  if (!a) return remaining;
  return Math.max(0, a.remaining - Math.max(0, now - a.at));
}
import { create } from 'zustand';
import type { TimeSyncDto } from '@wcc/shared';

/**
 * Authoritative server clock. `time:sync` pulses every second with the exact
 * remaining ms and derived phase — this is the ONLY timer the UI trusts. The
 * browser re-renders locally between pulses (see useRemainingTime) but always
 * re-anchors to this value when it arrives.
 */
interface ClockState {
  time: TimeSyncDto | null;
  applyTimeSync: (t: TimeSyncDto) => void;
  clear: () => void;
}

export const useClockStore = create<ClockState>()((set) => ({
  time: null,
  applyTimeSync: (t) => set({ time: t }),
  clear: () => set({ time: null }),
}));

/** Reactive helpers so components subscribe to one narrow slice. */
export function useServerPhase() {
  return useClockStore((s) => s.time?.state ?? null);
}
export function useServerRemainingMs() {
  return useClockStore((s) => s.time?.remainingMs ?? null);
}
export function useServerPhaseRules() {
  return useClockStore((s) => s.time?.phase ?? null);
}
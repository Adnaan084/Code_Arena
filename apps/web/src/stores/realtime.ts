import { setSocketHandlers, scheduleResync } from '../lib/socket';
import type { HostGameState, PublicDisplayState, TeamGameState } from '@wcc/shared';
import { useTeamStore } from './team';
import { useHostStore } from './host';
import { useDisplayStore } from './display';
import { useClockStore } from './clock';
import { useConnectionStore } from './connection';
import { useAuthStore } from './auth';

/**
 * Single wiring point: routes every wire event to the right store. Called once
 * at app bootstrap. `state:sync` replaces the matching role-shaped store;
 * `time:sync` feeds the shared clock; `game:event` schedules an authoritative
 * resync (the wire payload deliberately carries no amounts); presence routes to
 * the active role (host: all teams, team: its own room).
 */
export function isTeamState(s: unknown): s is TeamGameState {
  return typeof s === 'object' && s !== null && 'team' in s;
}
export function isHostState(s: unknown): s is HostGameState {
  return typeof s === 'object' && s !== null && 'teams' in s;
}
export function isDisplayState(s: unknown): s is PublicDisplayState {
  return typeof s === 'object' && s !== null && 'recentActivity' in s;
}

let wired = false;

export function initRealtime() {
  if (wired) return;
  wired = true;

  setSocketHandlers({
    onState: (s) => {
      if (isHostState(s)) useHostStore.getState().applyState(s);
      else if (isDisplayState(s)) useDisplayStore.getState().applyState(s);
      else if (isTeamState(s)) useTeamStore.getState().applyState(s);
    },
    onTime: (t) => useClockStore.getState().applyTimeSync(t),
    // Wire events are domain notices; coins/trades need the full picture, so
    // pull authoritative state. Debounced inside the socket service.
    onEvent: () => scheduleResync(),
    onPresence: (p) => {
      const role = useAuthStore.getState().role;
      if (role === 'host') useHostStore.getState().applyPresence(p);
      else useTeamStore.getState().applyPresence(p);
    },
    onStatus: (s) => useConnectionStore.getState().setStatus(s),
    onError: (e) => useConnectionStore.getState().setLastError(e),
    onLeaderboard: (l) => {
      // state:sync carries the full board; live `leaderboard` is an accelerator.
      const role = useAuthStore.getState().role;
      if (role === 'host') useHostStore.setState({ leaderboard: l.rows });
      else useTeamStore.setState({ leaderboard: l.rows });
    },
    onAnnouncement: (a) => {
      const role = useAuthStore.getState().role;
      const meta = role === 'host' ? useHostStore.getState().meta : useTeamStore.getState().meta;
      const announcements = meta ? [a, ...(meta.announcements ?? [])].slice(0, 10) : [a];
      const patch = { meta: meta ? { ...meta, announcements } : meta };
      if (role === 'host') useHostStore.setState({ meta: patch.meta ?? null });
      else useTeamStore.setState({ meta: patch.meta ?? null });
    },
    onPhase: () => {
      // phase is covered by time:sync once a clock exists; resync for the
      // transitional state so meta reflects the new phase immediately.
      scheduleResync(120);
    },
    onReload: () => {
      useClockStore.getState().clear();
      scheduleResync(0);
    },
  });
}
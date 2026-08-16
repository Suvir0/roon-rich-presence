import type { DesiredPresence } from './types.js';

const WINDOW_MS = 20_000;
const MAX_SETS_PER_WINDOW = 5;

export interface UpdateThrottleState {
  setTimestamps: readonly number[];
  lastFingerprint?: string;
  pending?: DesiredPresence;
}

export interface UpdateThrottleResult {
  state: UpdateThrottleState;
  dispatch?: DesiredPresence;
  nextEligibleAtMs?: number;
}

export const EMPTY_THROTTLE_STATE: UpdateThrottleState = { setTimestamps: [] };

/** Coalesces set operations. Clears bypass the set rate limit so stop stays immediate. */
export function planPresenceUpdate(
  previous: UpdateThrottleState,
  desired: DesiredPresence,
  nowMs: number
): UpdateThrottleResult {
  const timestamps = previous.setTimestamps.filter((at) => at > nowMs - WINDOW_MS);
  const fingerprint = presenceFingerprint(desired);
  if (fingerprint === previous.lastFingerprint) {
    const withoutPending = { ...previous };
    delete withoutPending.pending;
    return { state: { ...withoutPending, setTimestamps: timestamps } };
  }
  if (desired.kind === 'clear') {
    return {
      dispatch: desired,
      state: { setTimestamps: timestamps, lastFingerprint: fingerprint }
    };
  }
  if (timestamps.length < MAX_SETS_PER_WINDOW) {
    return {
      dispatch: desired,
      state: { setTimestamps: [...timestamps, nowMs], lastFingerprint: fingerprint }
    };
  }
  return {
    state: { ...previous, setTimestamps: timestamps, pending: desired },
    nextEligibleAtMs: timestamps[0]! + WINDOW_MS
  };
}

export function flushPendingPresence(
  previous: UpdateThrottleState,
  nowMs: number
): UpdateThrottleResult {
  if (!previous.pending) return { state: previous };
  const { pending, ...withoutPending } = previous;
  return planPresenceUpdate(withoutPending, pending, nowMs);
}

export function presenceFingerprint(value: DesiredPresence): string {
  if (value.kind === 'clear') return 'clear';
  // Seek ticks change timestamps every second. Including them here burns the
  // Discord rate limit, so track/artist/art updates then wait up to 20s.
  const identity = { ...value.activity };
  delete identity.timestamps;
  return `set:${JSON.stringify(identity)}`;
}

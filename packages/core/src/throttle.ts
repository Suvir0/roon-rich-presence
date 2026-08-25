import type { ActivityTimestamps, DesiredPresence } from './types.js';

const WINDOW_MS = 20_000;
const MAX_SETS_PER_WINDOW = 5;
/**
 * Playback that is simply advancing keeps a constant start timestamp, give or take
 * the jitter between Roon's seek reports and our own clock. A seek moves it by the
 * size of the jump, so anything past a few seconds is a real position change rather
 * than a tick.
 */
export const SEEK_DRIFT_SECONDS = 5;

export interface UpdateThrottleState {
  setTimestamps: readonly number[];
  lastFingerprint?: string;
  /** Timestamps of the last dispatched activity, used to detect seeks. */
  lastTimestamps?: ActivityTimestamps;
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
  const nextTimestamps = desired.kind === 'set' ? desired.activity.timestamps : undefined;
  const changed =
    fingerprint !== previous.lastFingerprint ||
    hasSeeked(previous.lastTimestamps, nextTimestamps, SEEK_DRIFT_SECONDS);
  if (!changed) {
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
      state: {
        setTimestamps: [...timestamps, nowMs],
        lastFingerprint: fingerprint,
        ...(nextTimestamps ? { lastTimestamps: nextTimestamps } : {})
      }
    };
  }
  return {
    state: { ...previous, setTimestamps: timestamps, pending: desired },
    nextEligibleAtMs: timestamps[0]! + WINDOW_MS
  };
}

/**
 * Reports whether the elapsed position jumped rather than advanced. Timestamps
 * appearing or disappearing (progress turned off, a pause that drops them) is
 * already a fingerprint change, so only a start that moved counts here.
 */
export function hasSeeked(
  previous: ActivityTimestamps | undefined,
  next: ActivityTimestamps | undefined,
  driftSeconds = SEEK_DRIFT_SECONDS
): boolean {
  if (!previous || !next) return false;
  return Math.abs(next.start - previous.start) > driftSeconds;
}

export function presenceFingerprint(value: DesiredPresence): string {
  if (value.kind === 'clear') return 'clear';
  // Seek ticks change timestamps every second. Including their values here burns
  // the Discord rate limit, so track/artist/art updates then wait up to 20s; a jump
  // large enough to be a real seek is caught by hasSeeked instead. Whether a
  // timeline exists at all is part of the identity, because pausing and turning
  // Progress off both drop it while leaving every other field untouched.
  const { timestamps, ...identity } = value.activity;
  return `set:${JSON.stringify({
    ...identity,
    hasTimestamps: Boolean(timestamps),
    hasEndTimestamp: Boolean(timestamps?.end)
  })}`;
}

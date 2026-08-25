import { describe, expect, it } from 'vitest';
import { EMPTY_THROTTLE_STATE, planPresenceUpdate } from './throttle.js';
import type { DesiredPresence } from './types.js';

const set = (name: string): DesiredPresence => ({
  kind: 'set',
  activity: { type: 'listening', details: name, largeImage: 'fallback' }
});

const playing = (start: number): DesiredPresence => ({
  kind: 'set',
  activity: { type: 'listening', details: 'Song', timestamps: { start, end: start + 200 } }
});

describe('presence update throttling', () => {
  it('deduplicates identical payloads', () => {
    const first = planPresenceUpdate(EMPTY_THROTTLE_STATE, set('one'), 0);
    expect(first.dispatch).toBeDefined();
    expect(planPresenceUpdate(first.state, set('one'), 1).dispatch).toBeUndefined();
  });

  it('coalesces after five sets and reports when the window reopens', () => {
    let state = EMPTY_THROTTLE_STATE;
    for (let index = 0; index < 5; index += 1)
      state = planPresenceUpdate(state, set(String(index)), index).state;
    const blocked = planPresenceUpdate(state, set('pending'), 5);
    expect(blocked.dispatch).toBeUndefined();
    expect(blocked.nextEligibleAtMs).toBe(20_000);
    // The caller recomputes at nextEligibleAtMs rather than dispatching stale state.
    expect(planPresenceUpdate(blocked.state, set('pending'), 20_000).dispatch).toEqual(
      set('pending')
    );
  });

  it('does not treat clock jitter on a steady track as a new activity', () => {
    const first = planPresenceUpdate(EMPTY_THROTTLE_STATE, playing(100), 0);
    expect(first.dispatch).toBeDefined();
    expect(planPresenceUpdate(first.state, playing(101), 1_000).dispatch).toBeUndefined();
    expect(planPresenceUpdate(first.state, playing(105), 1_000).dispatch).toBeUndefined();
  });

  it('republishes the same track after a seek moves the position', () => {
    const first = planPresenceUpdate(EMPTY_THROTTLE_STATE, playing(100), 0);
    const seek = planPresenceUpdate(first.state, playing(160), 1_000);
    expect(seek.dispatch).toEqual(playing(160));
    // The dispatched position becomes the new baseline, so ticks after it stay quiet.
    expect(planPresenceUpdate(seek.state, playing(161), 2_000).dispatch).toBeUndefined();
  });

  it('rewinds as well as skips forward', () => {
    const first = planPresenceUpdate(EMPTY_THROTTLE_STATE, playing(100), 0);
    expect(planPresenceUpdate(first.state, playing(20), 1_000).dispatch).toEqual(playing(20));
  });

  it('coalesces repeated scrubbing within one rate-limit window', () => {
    let state = EMPTY_THROTTLE_STATE;
    for (let index = 0; index < 5; index += 1)
      state = planPresenceUpdate(state, playing(index * 100), index).state;
    const blocked = planPresenceUpdate(state, playing(900), 5);
    expect(blocked.dispatch).toBeUndefined();
    expect(blocked.nextEligibleAtMs).toBe(20_000);
    expect(planPresenceUpdate(blocked.state, playing(950), 20_000).dispatch).toEqual(playing(950));
  });

  it('republishes when a timeline appears or disappears on an otherwise identical card', () => {
    const untimed: DesiredPresence = {
      kind: 'set',
      activity: { type: 'listening', details: 'Song' }
    };
    const withTimestamps = planPresenceUpdate(EMPTY_THROTTLE_STATE, playing(100), 0);
    // Pausing and turning Progress off both drop the timeline and change nothing else.
    const paused = planPresenceUpdate(withTimestamps.state, untimed, 1_000);
    expect(paused.dispatch).toEqual(untimed);
    expect(planPresenceUpdate(paused.state, untimed, 2_000).dispatch).toBeUndefined();
    expect(planPresenceUpdate(paused.state, playing(160), 3_000).dispatch).toEqual(playing(160));
  });

  it('republishes when a duration arrives after playback started', () => {
    const openEnded: DesiredPresence = {
      kind: 'set',
      activity: { type: 'listening', details: 'Song', timestamps: { start: 100 } }
    };
    const first = planPresenceUpdate(EMPTY_THROTTLE_STATE, openEnded, 0);
    expect(planPresenceUpdate(first.state, playing(100), 1_000).dispatch).toEqual(playing(100));
  });

  it('always dispatches clear immediately', () => {
    let state = EMPTY_THROTTLE_STATE;
    for (let index = 0; index < 5; index += 1)
      state = planPresenceUpdate(state, set(String(index)), index).state;
    expect(planPresenceUpdate(state, { kind: 'clear' }, 10).dispatch).toEqual({ kind: 'clear' });
  });
});

import { describe, expect, it } from 'vitest';
import { EMPTY_THROTTLE_STATE, flushPendingPresence, planPresenceUpdate } from './throttle.js';
import type { DesiredPresence } from './types.js';

const set = (name: string): DesiredPresence => ({
  kind: 'set',
  activity: { type: 'listening', details: name, largeImage: 'fallback' }
});

describe('presence update throttling', () => {
  it('deduplicates identical payloads', () => {
    const first = planPresenceUpdate(EMPTY_THROTTLE_STATE, set('one'), 0);
    expect(first.dispatch).toBeDefined();
    expect(planPresenceUpdate(first.state, set('one'), 1).dispatch).toBeUndefined();
  });

  it('coalesces after five sets and flushes the latest after the window', () => {
    let state = EMPTY_THROTTLE_STATE;
    for (let index = 0; index < 5; index += 1)
      state = planPresenceUpdate(state, set(String(index)), index).state;
    const blocked = planPresenceUpdate(state, set('pending'), 5);
    expect(blocked.dispatch).toBeUndefined();
    expect(blocked.nextEligibleAtMs).toBe(20_000);
    const flushed = flushPendingPresence(blocked.state, 20_000);
    expect(flushed.dispatch).toEqual(set('pending'));
  });

  it('does not treat seek timestamp ticks as a new activity', () => {
    const first = planPresenceUpdate(
      EMPTY_THROTTLE_STATE,
      {
        kind: 'set',
        activity: {
          type: 'listening',
          details: 'Song',
          timestamps: { start: 100, end: 200 }
        }
      },
      0
    );
    expect(first.dispatch).toBeDefined();
    const seek = planPresenceUpdate(
      first.state,
      {
        kind: 'set',
        activity: {
          type: 'listening',
          details: 'Song',
          timestamps: { start: 101, end: 201 }
        }
      },
      1_000
    );
    expect(seek.dispatch).toBeUndefined();
  });

  it('always dispatches clear immediately', () => {
    let state = EMPTY_THROTTLE_STATE;
    for (let index = 0; index < 5; index += 1)
      state = planPresenceUpdate(state, set(String(index)), index).state;
    expect(planPresenceUpdate(state, { kind: 'clear' }, 10).dispatch).toEqual({ kind: 'clear' });
  });
});

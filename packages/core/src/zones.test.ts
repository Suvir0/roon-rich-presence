import { describe, expect, it } from 'vitest';
import type { PlaybackState } from './types.js';
import { selectActiveZone } from './zones.js';

const zones: PlaybackState[] = [
  { zoneId: 'b', zoneName: 'Bedroom', state: 'playing' },
  { zoneId: 'a', zoneName: 'Atrium', state: 'playing' }
];

describe('selectActiveZone', () => {
  it('uses the explicitly selected zone', () => {
    expect(selectActiveZone(zones, { zoneMode: 'selected', selectedZoneId: 'b' })?.zoneId).toBe(
      'b'
    );
  });

  it('chooses deterministically and remains sticky while paused or loading', () => {
    expect(selectActiveZone(zones, { zoneMode: 'automatic' })?.zoneId).toBe('a');
    const changed = zones.map((zone) =>
      zone.zoneId === 'b' ? { ...zone, state: 'paused' as const } : zone
    );
    expect(selectActiveZone(changed, { zoneMode: 'automatic' }, 'b')?.zoneId).toBe('b');
  });

  it('switches only after the sticky zone stops or disappears', () => {
    const stopped = zones.map((zone) =>
      zone.zoneId === 'b' ? { ...zone, state: 'stopped' as const } : zone
    );
    expect(selectActiveZone(stopped, { zoneMode: 'automatic' }, 'b')?.zoneId).toBe('a');
    expect(
      selectActiveZone(
        zones.filter((zone) => zone.zoneId !== 'b'),
        { zoneMode: 'automatic' },
        'b'
      )?.zoneId
    ).toBe('a');
  });
});

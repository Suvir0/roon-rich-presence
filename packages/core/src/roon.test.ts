import { describe, expect, it } from 'vitest';
import { normalizeRoonZone, reduceZoneEvent } from './roon.js';

describe('Roon zone normalization', () => {
  it('maps three-line metadata and cleans values', () => {
    expect(
      normalizeRoonZone({
        zone_id: 'z1',
        display_name: ' Living   Room ',
        state: 'playing',
        now_playing: {
          three_line: { line1: ' Track ', line2: 'Artist', line3: 'Album' },
          seek_position: 12.8,
          length: 180,
          image_key: 'image'
        }
      })
    ).toEqual({
      zoneId: 'z1',
      zoneName: 'Living Room',
      state: 'playing',
      track: 'Track',
      artist: 'Artist',
      album: 'Album',
      positionSeconds: 12.8,
      durationSeconds: 180,
      imageKey: 'image'
    });
  });

  it('falls back to two-line radio metadata and handles invalid fields', () => {
    expect(
      normalizeRoonZone({
        zone_id: 'radio',
        state: 'unknown',
        now_playing: { two_line: { line1: 'Station', line2: 'Live' }, length: -1 }
      })
    ).toEqual({
      zoneId: 'radio',
      zoneName: 'Unnamed zone',
      state: 'stopped',
      track: 'Station',
      artist: 'Live'
    });
  });
});

describe('reduceZoneEvent', () => {
  it('replaces state on a full event', () => {
    const next = reduceZoneEvent(
      { old: { zoneId: 'old', zoneName: 'Old', state: 'playing' } },
      {
        type: 'full',
        zones: [{ zone_id: 'new', display_name: 'New', state: 'paused' }]
      }
    );
    expect(Object.keys(next)).toEqual(['new']);
  });

  it('applies add, change, remove, and seek deltas', () => {
    const initial = reduceZoneEvent(
      {},
      {
        type: 'full',
        zones: [
          { zone_id: 'a', display_name: 'A', state: 'playing', now_playing: { seek_position: 1 } },
          { zone_id: 'b', display_name: 'B', state: 'playing' }
        ]
      }
    );
    const next = reduceZoneEvent(initial, {
      type: 'delta',
      zonesRemoved: [{ zone_id: 'b' }],
      zonesChanged: [{ zone_id: 'a', display_name: 'A', state: 'paused' }],
      zonesAdded: [{ zone_id: 'c', display_name: 'C', state: 'playing' }],
      zonesSeekChanged: [{ zone_id: 'a', seek_position: 42 }]
    });
    expect(next).toEqual({
      a: { zoneId: 'a', zoneName: 'A', state: 'paused', positionSeconds: 42 },
      c: { zoneId: 'c', zoneName: 'C', state: 'playing' }
    });
  });
});

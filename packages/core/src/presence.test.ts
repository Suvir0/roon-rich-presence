import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from './settings.js';
import { calculateTimestamps, mapPresence, truncateDiscordText } from './presence.js';
import type { PlaybackState } from './types.js';

const playback: PlaybackState = {
  zoneId: 'z',
  zoneName: 'Office',
  state: 'playing',
  track: 'Song',
  artist: 'Artist',
  album: 'Album',
  positionSeconds: 30,
  durationSeconds: 180
};
const assets = { fallbackLargeImage: 'fallback', smallImage: 'app' };

describe('presence mapping', () => {
  it('maps metadata, assets, zone, and progress timestamps', () => {
    const result = mapPresence(
      playback,
      { ...DEFAULT_SETTINGS },
      { ...assets, artworkUrl: 'https://cover' },
      1_000_000
    );
    expect(result.desired).toEqual({
      kind: 'set',
      activity: {
        type: 'listening',
        details: 'Song',
        state: 'Artist — Album — Office',
        largeImage: 'https://cover',
        largeText: 'Album',
        smallImage: 'app',
        smallText: 'Office',
        timestamps: { start: 970, end: 1150 }
      }
    });
  });

  it('clears stopped/paused playback unless paused display is enabled', () => {
    expect(
      mapPresence({ ...playback, state: 'stopped' }, { ...DEFAULT_SETTINGS }, assets, 0).desired
        .kind
    ).toBe('clear');
    expect(
      mapPresence({ ...playback, state: 'paused' }, { ...DEFAULT_SETTINGS }, assets, 0).desired.kind
    ).toBe('clear');
    const paused = mapPresence(
      { ...playback, state: 'paused' },
      { ...DEFAULT_SETTINGS, showWhenPaused: true },
      assets,
      0
    );
    expect(paused.desired.kind).toBe('set');
    if (paused.desired.kind === 'set') expect(paused.desired.activity.timestamps).toBeUndefined();
  });

  it('holds the prior card during only the ten-second loading grace', () => {
    const playing = mapPresence(playback, { ...DEFAULT_SETTINGS }, assets, 100);
    expect(
      mapPresence(
        { ...playback, track: undefined, artist: undefined, album: undefined, state: 'loading' },
        { ...DEFAULT_SETTINGS },
        assets,
        10_100,
        playing.memory
      ).reason
    ).toBe('loading-grace');
    expect(
      mapPresence(
        { ...playback, track: undefined, artist: undefined, album: undefined, state: 'loading' },
        { ...DEFAULT_SETTINGS },
        assets,
        10_101,
        playing.memory
      ).desired.kind
    ).toBe('clear');
  });

  it('publishes the next track as soon as Roon reveals it during loading', () => {
    const playing = mapPresence(playback, { ...DEFAULT_SETTINGS }, assets, 100);
    const next = mapPresence(
      { ...playback, state: 'loading', track: 'Next song' },
      { ...DEFAULT_SETTINGS },
      assets,
      200,
      playing.memory
    );
    expect(next.reason).toBe('playing');
    expect(next.desired.kind === 'set' && next.desired.activity.details).toBe('Next song');
  });

  it('uses sensible missing metadata fallbacks and feature toggles', () => {
    const result = mapPresence(
      { zoneId: 'z', zoneName: 'Z', state: 'playing' },
      { ...DEFAULT_SETTINGS, showAlbum: false, showProgress: false, showZone: false },
      assets,
      0
    );
    expect(result.desired).toEqual({
      kind: 'set',
      activity: {
        type: 'listening',
        details: 'Unknown track',
        state: 'Unknown artist',
        largeImage: 'fallback',
        smallImage: 'app'
      }
    });
  });
});

describe('presence formatting', () => {
  it('calculates live timestamps including streams with no known end', () => {
    expect(calculateTimestamps(10_900, 3.9, 20.9)).toEqual({ start: 7, end: 27 });
    expect(calculateTimestamps(10_900, 3.9)).toEqual({ start: 7 });
    expect(calculateTimestamps(10_900, -1)).toBeUndefined();
  });

  it('truncates long Discord text to 128 characters', () => {
    const result = truncateDiscordText('x'.repeat(200));
    expect(result).toHaveLength(128);
    expect(result.endsWith('…')).toBe(true);
  });
});

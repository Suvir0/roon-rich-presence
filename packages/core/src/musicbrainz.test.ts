import { describe, expect, it } from 'vitest';
import {
  ARTWORK_HIT_TTL_MS,
  ARTWORK_MISS_TTL_MS,
  artworkCacheKey,
  isArtworkCacheEntryFresh,
  normalizeMetadata,
  primaryArtistForArtwork,
  pruneArtworkCache,
  selectArtworkMatch,
  selectMusicBrainzReleaseGroup
} from './musicbrainz.js';

describe('MusicBrainz matching', () => {
  it('normalizes case, accents, punctuation, and whitespace', () => {
    expect(normalizeMetadata('  Björk: Début! ')).toBe('bjork debut');
    expect(artworkCacheKey('Artist', 'Album')).toBe('artist\u0000album');
  });

  it('requires an exact normalized high-confidence result with front art', () => {
    expect(
      selectArtworkMatch('Björk', 'Début', [
        { id: 'bad-score', artist: 'Björk', title: 'Début', score: 94, hasFrontArtwork: true },
        { id: 'no-art', artist: 'Björk', title: 'Début', score: 100, hasFrontArtwork: false },
        { id: 'winner', artist: 'bjork', title: 'debut', score: 99, hasFrontArtwork: true }
      ])
    ).toEqual({
      releaseGroupId: 'winner',
      artworkUrl: 'https://coverartarchive.org/release-group/winner/front'
    });
  });

  it('accepts unknown artwork availability for later CAA verification', () => {
    expect(
      selectArtworkMatch('Artist', 'Album', [
        { id: 'candidate', artist: 'Artist', title: 'Album', score: 100 }
      ])
    ).toEqual({
      releaseGroupId: 'candidate',
      artworkUrl: 'https://coverartarchive.org/release-group/candidate/front'
    });
  });

  it('uses the primary Roon credit for artwork searches without breaking slash names', () => {
    expect(primaryArtistForArtwork('Childish Gambino / Jason Martin')).toBe('Childish Gambino');
    expect(primaryArtistForArtwork('AC/DC')).toBe('AC/DC');
  });

  it('rejects ambiguous equally scored editions and ignores results beyond five', () => {
    expect(
      selectArtworkMatch('A', 'B', [
        { id: 'one', artist: 'A', title: 'B', score: 100, hasFrontArtwork: true },
        { id: 'two', artist: 'A', title: 'B', score: 100, hasFrontArtwork: true }
      ])
    ).toBeUndefined();
    expect(
      selectArtworkMatch('A', 'B', [
        ...Array.from({ length: 5 }, (_, index) => ({
          id: String(index),
          artist: 'X',
          title: 'Y',
          score: 100,
          hasFrontArtwork: true
        })),
        { id: 'six', artist: 'A', title: 'B', score: 100, hasFrontArtwork: true }
      ])
    ).toBeUndefined();
  });

  it('selects exact metadata before artwork availability is queried separately', () => {
    expect(
      selectMusicBrainzReleaseGroup('Childish Gambino', 'Awaken, My Love!', [
        {
          id: 'release-group-id',
          artist: 'Childish Gambino',
          title: 'Awaken, My Love!',
          score: 100,
          hasFrontArtwork: false
        }
      ])
    ).toEqual({ releaseGroupId: 'release-group-id' });
  });
});

describe('artwork cache policy', () => {
  it('uses separate hit and miss TTLs', () => {
    const base = { key: 'key', createdAtMs: 0, lastAccessedAtMs: 0 };
    expect(
      isArtworkCacheEntryFresh(
        { ...base, value: { releaseGroupId: 'id', artworkUrl: 'url' } },
        ARTWORK_HIT_TTL_MS - 1
      )
    ).toBe(true);
    expect(
      isArtworkCacheEntryFresh(
        { ...base, value: { releaseGroupId: 'id', artworkUrl: 'url' } },
        ARTWORK_HIT_TTL_MS
      )
    ).toBe(false);
    expect(isArtworkCacheEntryFresh(base, ARTWORK_MISS_TTL_MS)).toBe(false);
  });

  it('drops expired entries and retains most recently used entries', () => {
    const entries = [
      { key: 'old', createdAtMs: 0, lastAccessedAtMs: 10 },
      { key: 'recent', createdAtMs: ARTWORK_MISS_TTL_MS, lastAccessedAtMs: 30 },
      { key: 'middle', createdAtMs: ARTWORK_MISS_TTL_MS, lastAccessedAtMs: 20 }
    ];
    expect(
      pruneArtworkCache(entries, ARTWORK_MISS_TTL_MS + 1, 1).map((entry) => entry.key)
    ).toEqual(['recent']);
  });
});

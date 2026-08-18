import { describe, expect, it } from 'vitest';
import {
  ARTWORK_HIT_TTL_MS,
  ARTWORK_MISS_TTL_MS,
  albumForArtwork,
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

  it('removes trailing edition labels from artwork lookup titles', () => {
    expect(albumForArtwork('After Hours (Explicit)')).toBe('After Hours');
    expect(albumForArtwork('Album — Deluxe Edition [Explicit]')).toBe('Album');
    expect(albumForArtwork('Rumours (2013 Remaster)')).toBe('Rumours');
    expect(albumForArtwork('The Deluxe')).toBe('The Deluxe');
    expect(albumForArtwork('Explicit')).toBe('Explicit');
    expect(artworkCacheKey('The Weeknd', 'After Hours (Explicit)')).toBe(
      'the weeknd\u0000after hours'
    );
  });

  it('matches a canonical release title to a Roon title with an edition label', () => {
    expect(
      selectMusicBrainzReleaseGroup('The Weeknd', 'After Hours (Explicit)', [
        { id: 'release-group-id', artists: ['The Weeknd'], title: 'After Hours', score: 100 }
      ])
    ).toEqual({ releaseGroupId: 'release-group-id' });
  });

  it('strips a trailing edition marker followed by a separate release subtitle', () => {
    expect(albumForArtwork('Eternal Atake (Deluxe) [LUV vs. The World 2]')).toBe(
      'Eternal Atake'
    );
    expect(albumForArtwork('Album (Explicit) [Bonus Track Version]')).toBe('Album');
  });

  it('leaves a trailing bracket run alone when none of it is a recognized edition label', () => {
    expect(albumForArtwork('Look at Me [Live]')).toBe('Look at Me [Live]');
    expect(albumForArtwork('Album (Remix) [Radio Edit]')).toBe('Album (Remix) [Radio Edit]');
  });

  it('matches a Roon release with a deluxe marker and an unrelated subtitle', () => {
    expect(
      selectMusicBrainzReleaseGroup(
        'Lil Uzi Vert',
        'Eternal Atake (Deluxe) [LUV vs. The World 2]',
        [{ id: 'release-group-id', artists: ['Lil Uzi Vert'], title: 'Eternal Atake', score: 100 }]
      )
    ).toEqual({ releaseGroupId: 'release-group-id' });
  });

  it('matches a collaboration credited under multiple performer names', () => {
    expect(
      selectMusicBrainzReleaseGroup('Dave', 'Split Decision', [
        {
          id: 'release-group-id',
          artists: ['Dave', 'Central Cee'],
          title: 'Split Decision',
          score: 100
        }
      ])
    ).toEqual({ releaseGroupId: 'release-group-id' });
    expect(
      selectArtworkMatch('Dave', 'Split Decision', [
        {
          id: 'release-group-id',
          artists: ['Dave', 'Central Cee'],
          title: 'Split Decision',
          score: 100,
          hasFrontArtwork: true
        }
      ])
    ).toEqual({
      releaseGroupId: 'release-group-id',
      artworkUrl: 'https://coverartarchive.org/release-group/release-group-id/front'
    });
  });

  it('does not match an unrelated artist whose name partially overlaps', () => {
    expect(
      selectMusicBrainzReleaseGroup('Dave', 'Split Decision', [
        { id: 'other', artists: ['Dave Matthews Band'], title: 'Split Decision', score: 100 }
      ])
    ).toBeUndefined();
  });

  it('requires an exact normalized high-confidence result with front art', () => {
    expect(
      selectArtworkMatch('Björk', 'Début', [
        { id: 'bad-score', artists: ['Björk'], title: 'Début', score: 94, hasFrontArtwork: true },
        { id: 'no-art', artists: ['Björk'], title: 'Début', score: 100, hasFrontArtwork: false },
        { id: 'winner', artists: ['bjork'], title: 'debut', score: 99, hasFrontArtwork: true }
      ])
    ).toEqual({
      releaseGroupId: 'winner',
      artworkUrl: 'https://coverartarchive.org/release-group/winner/front'
    });
  });

  it('accepts unknown artwork availability for later CAA verification', () => {
    expect(
      selectArtworkMatch('Artist', 'Album', [
        { id: 'candidate', artists: ['Artist'], title: 'Album', score: 100 }
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
        { id: 'one', artists: ['A'], title: 'B', score: 100, hasFrontArtwork: true },
        { id: 'two', artists: ['A'], title: 'B', score: 100, hasFrontArtwork: true }
      ])
    ).toBeUndefined();
    expect(
      selectArtworkMatch('A', 'B', [
        ...Array.from({ length: 5 }, (_, index) => ({
          id: String(index),
          artists: ['X'],
          title: 'Y',
          score: 100,
          hasFrontArtwork: true
        })),
        { id: 'six', artists: ['A'], title: 'B', score: 100, hasFrontArtwork: true }
      ])
    ).toBeUndefined();
  });

  it('selects exact metadata before artwork availability is queried separately', () => {
    expect(
      selectMusicBrainzReleaseGroup('Childish Gambino', 'Awaken, My Love!', [
        {
          id: 'release-group-id',
          artists: ['Childish Gambino'],
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

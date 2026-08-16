export const ARTWORK_HIT_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
export const ARTWORK_MISS_TTL_MS = 24 * 60 * 60 * 1_000;
export const MAX_ARTWORK_CACHE_ENTRIES = 2_000;

export interface MusicBrainzCandidate {
  id: string;
  title: string;
  artist: string;
  score: number;
  /** False means definitively unavailable. Undefined means the search API did not report it. */
  hasFrontArtwork?: boolean;
}

export interface ArtworkMatch {
  releaseGroupId: string;
  artworkUrl: string;
}

export interface MusicBrainzReleaseGroupMatch {
  releaseGroupId: string;
}

export interface ArtworkCacheEntry {
  key: string;
  value?: ArtworkMatch;
  createdAtMs: number;
  lastAccessedAtMs: number;
}

export function normalizeMetadata(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function artworkCacheKey(artist: string, album: string): string {
  return `${normalizeMetadata(artist)}\u0000${normalizeMetadata(album)}`;
}

/** Returns null for equally ranked editions because choosing would risk displaying the wrong cover. */
export function selectArtworkMatch(
  artist: string,
  album: string,
  candidates: readonly MusicBrainzCandidate[]
): ArtworkMatch | undefined {
  const normalizedArtist = normalizeMetadata(artist);
  const normalizedAlbum = normalizeMetadata(album);
  if (!normalizedArtist || !normalizedAlbum) return undefined;

  const eligible = candidates
    .slice(0, 5)
    .filter(
      (candidate) =>
        candidate.score >= 95 &&
        candidate.hasFrontArtwork !== false &&
        normalizeMetadata(candidate.artist) === normalizedArtist &&
        normalizeMetadata(candidate.title) === normalizedAlbum
    )
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
  const best = eligible[0];
  if (!best || (eligible[1] && eligible[1].score === best.score)) return undefined;
  return {
    releaseGroupId: best.id,
    artworkUrl: `https://coverartarchive.org/release-group/${encodeURIComponent(best.id)}/front`
  };
}

/**
 * Roon display lines can append composers/credits with spaced slashes. MusicBrainz's
 * release-group artist is normally the primary performer, so query that first credit.
 * Names containing an ordinary slash (for example AC/DC) remain untouched.
 */
export function primaryArtistForArtwork(value: string): string {
  return value.split(/\s+\/\s+/, 1)[0]?.trim() || value.trim();
}

/** Selects exact metadata before Cover Art Archive availability is queried separately. */
export function selectMusicBrainzReleaseGroup(
  artist: string,
  album: string,
  candidates: readonly MusicBrainzCandidate[]
): MusicBrainzReleaseGroupMatch | undefined {
  const normalizedArtist = normalizeMetadata(artist);
  const normalizedAlbum = normalizeMetadata(album);
  if (!normalizedArtist || !normalizedAlbum) return undefined;

  const eligible = candidates
    .slice(0, 5)
    .filter(
      (candidate) =>
        candidate.score >= 95 &&
        normalizeMetadata(candidate.artist) === normalizedArtist &&
        normalizeMetadata(candidate.title) === normalizedAlbum
    )
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
  const best = eligible[0];
  if (!best || (eligible[1] && eligible[1].score === best.score)) return undefined;
  return { releaseGroupId: best.id };
}

export function isArtworkCacheEntryFresh(entry: ArtworkCacheEntry, nowMs: number): boolean {
  const ttl = entry.value ? ARTWORK_HIT_TTL_MS : ARTWORK_MISS_TTL_MS;
  return nowMs >= entry.createdAtMs && nowMs - entry.createdAtMs < ttl;
}

/** Removes expired entries, then evicts least-recently-used entries to the configured bound. */
export function pruneArtworkCache(
  entries: readonly ArtworkCacheEntry[],
  nowMs: number,
  maxEntries = MAX_ARTWORK_CACHE_ENTRIES
): ArtworkCacheEntry[] {
  return entries
    .filter((entry) => isArtworkCacheEntryFresh(entry, nowMs))
    .sort((left, right) => right.lastAccessedAtMs - left.lastAccessedAtMs)
    .slice(0, Math.max(0, maxEntries));
}

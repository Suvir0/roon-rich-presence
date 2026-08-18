import { app } from 'electron';
import {
  albumForArtwork,
  artworkCacheKey,
  primaryArtistForArtwork,
  selectMusicBrainzReleaseGroup
} from '@rrp/core';
import { copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

interface CacheEntry {
  url?: string;
  expiresAt: number;
}

interface MusicBrainzArtistCredit {
  name?: unknown;
}

interface MusicBrainzReleaseGroup {
  id?: unknown;
  title?: unknown;
  score?: unknown;
  'artist-credit'?: unknown;
  'cover-art-archive'?: unknown;
}

interface CoverArtArchiveImage {
  front?: unknown;
}

export type ArtworkResolution =
  | { status: 'matched'; url: string }
  | { status: 'miss'; message: string }
  | { status: 'error'; message: string };

const SUCCESS_TTL = 30 * 24 * 60 * 60 * 1_000;
const MISS_TTL = 24 * 60 * 60 * 1_000;
const MAX_CACHE_ENTRIES = 2_000;
const MAX_RESPONSE_BYTES = 512 * 1_024;
const LOOKUP_RETRY_DELAY_MS = 1_100;

interface ArtworkServiceDependencies {
  fetch: typeof fetch;
  sleep(milliseconds: number): Promise<void>;
}

function getArtistCredits(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const credit = entry as MusicBrainzArtistCredit | null;
    return typeof credit?.name === 'string' ? [credit.name] : [];
  });
}

export class ArtworkService {
  private readonly cachePath = join(app.getPath('userData'), 'artwork-cache.json');
  private readonly cache = new Map<string, CacheEntry>();
  private lastRequestAt = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly dependencies: ArtworkServiceDependencies;

  constructor(dependencies: Partial<ArtworkServiceDependencies> = {}) {
    this.dependencies = {
      fetch: (input, init) => fetch(input, init),
      sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
      ...dependencies
    };
  }

  async initialize(): Promise<void> {
    await this.migrateLegacyCache();
    try {
      const parsed: unknown = JSON.parse(await readFile(this.cachePath, 'utf8'));
      if (parsed && typeof parsed === 'object') {
        for (const [key, value] of Object.entries(parsed)) {
          if (
            value &&
            typeof value === 'object' &&
            typeof (value as CacheEntry).expiresAt === 'number'
          ) {
            this.cache.set(key, value as CacheEntry);
          }
        }
      }
    } catch {
      // Cache misses and first launch are expected.
    }
    this.prune();
  }

  async resolve(artist: string | undefined, album: string | undefined): Promise<ArtworkResolution> {
    if (!artist || !album) {
      return { status: 'miss', message: 'Artist and album are required for artwork matching' };
    }
    const lookupArtist = primaryArtistForArtwork(artist);
    const lookupAlbum = albumForArtwork(album);
    // v4 invalidates cached misses from before compound edition/subtitle suffixes and
    // collaboration artist credits (e.g. "Dave & Central Cee") were matched correctly.
    const key = `v4:${artworkCacheKey(lookupArtist, lookupAlbum)}`;
    if (!key.replace('\u0000', '')) {
      return { status: 'miss', message: 'Artist and album are required for artwork matching' };
    }
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.url
        ? { status: 'matched', url: cached.url }
        : { status: 'miss', message: 'No exact public artwork match was found' };
    }

    const task = this.queue.then(async () => {
      const delay = Math.max(0, 1_050 - (Date.now() - this.lastRequestAt));
      if (delay > 0) await this.dependencies.sleep(delay);
      this.lastRequestAt = Date.now();
      const result = await this.lookup(lookupArtist, lookupAlbum);
      // Network/service failures are not negative matches and must remain retryable.
      if (result.status !== 'error') {
        this.cache.set(key, {
          ...(result.status === 'matched' ? { url: result.url } : {}),
          expiresAt: Date.now() + (result.status === 'matched' ? SUCCESS_TTL : MISS_TTL)
        });
        this.prune();
        await this.persist().catch(() => undefined);
      }
      return result;
    });
    this.queue = task.catch(() => undefined);
    return task;
  }

  private async lookup(artist: string, album: string): Promise<ArtworkResolution> {
    const query = `releasegroup:${JSON.stringify(album)} AND artist:${JSON.stringify(artist)}`;
    const url = new URL('https://musicbrainz.org/ws/2/release-group/');
    url.searchParams.set('query', query);
    url.searchParams.set('fmt', 'json');
    url.searchParams.set('limit', '5');
    const contact =
      process.env.PROJECT_CONTACT_URL ?? 'https://github.com/Suvir0/roon-rich-presence';

    let groups: MusicBrainzReleaseGroup[] | undefined;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await this.dependencies.fetch(url, {
          headers: {
            Accept: 'application/json',
            'User-Agent': `RoonRichPresence/0.1 (${contact})`
          },
          signal: AbortSignal.timeout(5_000),
          redirect: 'error'
        });
        if (!response.ok) throw new Error(`MusicBrainz HTTP ${response.status}`);
        const declaredSize = Number(response.headers.get('content-length') ?? '0');
        if (declaredSize > MAX_RESPONSE_BYTES) throw new Error('MusicBrainz response too large');
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.byteLength > MAX_RESPONSE_BYTES)
          throw new Error('MusicBrainz response too large');
        const payload: unknown = JSON.parse(new TextDecoder().decode(bytes));
        groups =
          payload &&
          typeof payload === 'object' &&
          Array.isArray((payload as { 'release-groups'?: unknown })['release-groups'])
            ? (payload as { 'release-groups': MusicBrainzReleaseGroup[] })['release-groups']
            : [];
        break;
      } catch (error) {
        if (attempt === 1) {
          return {
            status: 'error',
            message: describeLookupError('MusicBrainz', error)
          };
        }
        await this.dependencies.sleep(LOOKUP_RETRY_DELAY_MS);
      }
    }

    const match = selectMusicBrainzReleaseGroup(
      artist,
      album,
      (groups ?? []).flatMap((group) =>
        typeof group.id === 'string' &&
        /^[0-9a-f-]{36}$/i.test(group.id) &&
        typeof group.title === 'string'
          ? [
              {
                id: group.id,
                title: group.title,
                artists: getArtistCredits(group['artist-credit']),
                score: Number(group.score ?? 0),
                // Search responses omit this field; CAA is queried below.
                hasFrontArtwork: false
              }
            ]
          : []
      )
    );
    if (!match) {
      return { status: 'miss', message: 'No exact public MusicBrainz release match was found' };
    }

    const releaseGroupId = encodeURIComponent(match.releaseGroupId);
    const archiveUrl = new URL(`https://coverartarchive.org/release-group/${releaseGroupId}`);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await this.dependencies.fetch(archiveUrl, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(5_000),
          redirect: 'follow'
        });
        assertCoverArtResponseUrl(response.url);
        if (response.status === 404) {
          return { status: 'miss', message: 'This release has no public Cover Art Archive entry' };
        }
        if (!response.ok) throw new Error(`Cover Art Archive HTTP ${response.status}`);
        const declaredSize = Number(response.headers.get('content-length') ?? '0');
        if (declaredSize > MAX_RESPONSE_BYTES) throw new Error('response too large');
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.byteLength > MAX_RESPONSE_BYTES) throw new Error('response too large');
        const payload: unknown = JSON.parse(new TextDecoder().decode(bytes));
        const images =
          payload &&
          typeof payload === 'object' &&
          Array.isArray((payload as { images?: unknown }).images)
            ? ((payload as { images: CoverArtArchiveImage[] }).images ?? [])
            : [];
        if (!images.some((image) => image?.front === true)) {
          return { status: 'miss', message: 'This release has no public front cover' };
        }
        return {
          status: 'matched',
          url: `https://coverartarchive.org/release-group/${releaseGroupId}/front-500`
        };
      } catch (error) {
        if (attempt === 1) {
          return {
            status: 'error',
            message: describeLookupError('Cover Art Archive', error)
          };
        }
        await this.dependencies.sleep(LOOKUP_RETRY_DELAY_MS);
      }
    }
    return { status: 'error', message: 'Artwork lookup failed unexpectedly' };
  }

  private prune(): void {
    const now = Date.now();
    for (const [key, value] of this.cache) {
      if (value.expiresAt <= now) this.cache.delete(key);
    }
    while (this.cache.size > MAX_CACHE_ENTRIES) {
      const oldest = this.cache.keys().next().value as string | undefined;
      if (!oldest) break;
      this.cache.delete(oldest);
    }
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.cachePath), { recursive: true, mode: 0o700 });
    const temporary = `${this.cachePath}.tmp`;
    await writeFile(temporary, `${JSON.stringify(Object.fromEntries(this.cache), null, 2)}\n`, {
      mode: 0o600
    });
    await rename(temporary, this.cachePath);
  }

  private async migrateLegacyCache(): Promise<void> {
    const legacyPath = join(app.getPath('appData'), '@rrp', 'desktop', 'artwork-cache.json');
    if (legacyPath === this.cachePath) return;
    try {
      await stat(this.cachePath);
      return;
    } catch {
      // Destination does not exist yet.
    }
    try {
      await mkdir(dirname(this.cachePath), { recursive: true, mode: 0o700 });
      await copyFile(legacyPath, this.cachePath);
    } catch {
      // A missing legacy cache is expected; artwork can be fetched again.
    }
  }
}

function describeLookupError(service: string, error: unknown): string {
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return `${service} timed out; using branded fallback artwork`;
  }
  const detail = error instanceof Error ? error.message : 'request failed';
  return `${service} is unavailable (${detail.slice(0, 120)}); using branded fallback artwork`;
}

function assertCoverArtResponseUrl(value: string): void {
  const url = new URL(value);
  const allowedHost =
    url.hostname === 'coverartarchive.org' ||
    url.hostname === 'archive.org' ||
    url.hostname.endsWith('.archive.org');
  if (url.protocol !== 'https:' || !allowedHost) {
    throw new Error('response redirected outside the allowed service');
  }
}

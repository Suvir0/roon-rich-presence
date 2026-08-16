import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  directory: `/tmp/rrp-artwork-${Date.now()}-${Math.random().toString(16).slice(2)}`
}));

vi.mock('electron', () => ({
  app: {
    getPath: () => mocks.directory
  }
}));

import { ArtworkService } from './artwork-service';

afterEach(() => vi.unstubAllGlobals());
afterAll(() => rmSync(mocks.directory, { recursive: true, force: true }));

describe('ArtworkService album normalization', () => {
  it('queries the canonical album and replaces legacy negative-cache keys', async () => {
    const releaseGroupId = '01234567-89ab-cdef-0123-456789abcdef';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          'release-groups': [
            {
              id: releaseGroupId,
              title: 'After Hours',
              score: 100,
              'artist-credit': [{ name: 'The Weeknd' }]
            }
          ]
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(
          { images: [{ front: true }] },
          `https://coverartarchive.org/release-group/${releaseGroupId}`
        )
      );
    vi.stubGlobal('fetch', fetchMock);

    const service = new ArtworkService();
    await service.initialize();
    await expect(service.resolve('The Weeknd', 'After Hours (Explicit)')).resolves.toEqual({
      status: 'matched',
      url: `https://coverartarchive.org/release-group/${releaseGroupId}/front-500`
    });

    const musicBrainzUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(musicBrainzUrl.searchParams.get('query')).toBe(
      'releasegroup:"After Hours" AND artist:"The Weeknd"'
    );
    const cache = JSON.parse(
      readFileSync(join(mocks.directory, 'artwork-cache.json'), 'utf8')
    ) as Record<string, unknown>;
    expect(Object.keys(cache)).toEqual(['v3:the weeknd\u0000after hours']);
  });

  it('waits before retrying a transient MusicBrainz failure', async () => {
    const releaseGroupId = '11234567-89ab-cdef-0123-456789abcdef';
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('temporary network failure'))
      .mockResolvedValueOnce(
        jsonResponse({
          'release-groups': [
            {
              id: releaseGroupId,
              title: 'ICEMAN',
              score: 100,
              'artist-credit': [{ name: 'Drake' }]
            }
          ]
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(
          { images: [{ front: true }] },
          `https://coverartarchive.org/release-group/${releaseGroupId}`
        )
      );
    const sleep = vi.fn().mockResolvedValue(undefined);
    const service = new ArtworkService({ fetch: fetchMock, sleep });

    await expect(service.resolve('Drake', 'ICEMAN')).resolves.toEqual({
      status: 'matched',
      url: `https://coverartarchive.org/release-group/${releaseGroupId}/front-500`
    });
    expect(sleep).toHaveBeenCalledWith(1_100);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

function jsonResponse(
  payload: unknown,
  url = 'https://musicbrainz.org/ws/2/release-group/'
): Response {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  return {
    ok: true,
    status: 200,
    url,
    headers: new Headers({ 'content-length': String(bytes.byteLength) }),
    arrayBuffer: async () => bytes.buffer
  } as Response;
}

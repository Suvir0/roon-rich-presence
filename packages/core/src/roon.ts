import type { PlaybackState, PlaybackStatus } from './types.js';

export interface RoonDisplayLines {
  line1?: unknown;
  line2?: unknown;
  line3?: unknown;
}

export interface RoonNowPlaying {
  three_line?: RoonDisplayLines;
  two_line?: RoonDisplayLines;
  one_line?: RoonDisplayLines;
  seek_position?: unknown;
  length?: unknown;
  image_key?: unknown;
}

export interface RoonZone {
  zone_id?: unknown;
  display_name?: unknown;
  state?: unknown;
  now_playing?: RoonNowPlaying | null;
}

export type RoonZoneEvent =
  | { type: 'full'; zones: readonly RoonZone[] }
  | {
      type: 'delta';
      zonesAdded?: readonly RoonZone[];
      zonesChanged?: readonly RoonZone[];
      zonesRemoved?: readonly ({ zone_id?: unknown } | string)[];
      zonesSeekChanged?: readonly { zone_id?: unknown; seek_position?: unknown }[];
    };

export type ZoneMap = Readonly<Record<string, PlaybackState>>;

export function normalizeRoonZone(zone: RoonZone): PlaybackState | undefined {
  const zoneId = cleanText(zone.zone_id);
  if (!zoneId) return undefined;
  const nowPlaying = zone.now_playing ?? undefined;
  const lines = nowPlaying?.three_line ?? nowPlaying?.two_line ?? nowPlaying?.one_line;
  const track = cleanText(lines?.line1);
  const artist = cleanText(lines?.line2);
  const album = cleanText(lines?.line3);

  return compactOptional({
    zoneId,
    zoneName: cleanText(zone.display_name) ?? 'Unnamed zone',
    state: normalizeState(zone.state),
    track,
    artist,
    album,
    positionSeconds: nonNegativeNumber(nowPlaying?.seek_position),
    durationSeconds: positiveNumber(nowPlaying?.length),
    imageKey: cleanText(nowPlaying?.image_key)
  }) as PlaybackState;
}

/** Applies Roon's initial snapshot and subsequent partial Transport change sets. */
export function reduceZoneEvent(previous: ZoneMap, event: RoonZoneEvent): ZoneMap {
  if (event.type === 'full') {
    return Object.fromEntries(
      event.zones.flatMap((zone) => {
        const normalized = normalizeRoonZone(zone);
        return normalized ? [[normalized.zoneId, normalized] as const] : [];
      })
    );
  }

  const next: Record<string, PlaybackState> = { ...previous };
  for (const removed of event.zonesRemoved ?? []) {
    const id = cleanText(typeof removed === 'string' ? removed : removed.zone_id);
    if (id) delete next[id];
  }
  for (const raw of [...(event.zonesAdded ?? []), ...(event.zonesChanged ?? [])]) {
    const normalized = normalizeRoonZone(raw);
    if (normalized) next[normalized.zoneId] = normalized;
  }
  for (const seek of event.zonesSeekChanged ?? []) {
    const id = cleanText(seek.zone_id);
    const positionSeconds = nonNegativeNumber(seek.seek_position);
    if (id && positionSeconds !== undefined && next[id]) {
      next[id] = { ...next[id], positionSeconds };
    }
  }
  return next;
}

function normalizeState(value: unknown): PlaybackStatus {
  return value === 'playing' || value === 'paused' || value === 'loading' ? value : 'stopped';
}

function cleanText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean || undefined;
}

function nonNegativeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function compactOptional<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

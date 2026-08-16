import type { ActivityPayload, AppSettings, DesiredPresence, PlaybackState } from './types.js';

const DISCORD_TEXT_LIMIT = 128;
export const LOADING_GRACE_MS = 10_000;

export interface PresenceMemory {
  lastActivity?: ActivityPayload;
  lastPlayableAtMs?: number;
}

export interface PresenceResult {
  desired: DesiredPresence;
  memory: PresenceMemory;
  reason: 'playing' | 'paused' | 'disabled' | 'inactive' | 'loading-grace' | 'loading-expired';
}

export interface PresenceAssets {
  artworkUrl?: string;
  fallbackLargeImage?: string;
  smallImage?: string;
}

export function mapPresence(
  playback: PlaybackState | undefined,
  settings: AppSettings,
  assets: PresenceAssets,
  nowMs: number,
  previous: PresenceMemory = {}
): PresenceResult {
  if (!settings.presenceEnabled) return cleared('disabled');
  if (!playback || playback.state === 'stopped') return cleared('inactive');

  if (playback.state === 'loading') {
    const nextDetails = truncateDiscordText(playback.track ?? 'Unknown track');
    const trackAlreadyKnown =
      Boolean(playback.track) &&
      (!previous.lastActivity || previous.lastActivity.details !== nextDetails);
    // Roon often publishes the next track while state is still `loading`. Keep the
    // previous card only when metadata has not changed yet.
    if (
      !trackAlreadyKnown &&
      previous.lastActivity &&
      previous.lastPlayableAtMs !== undefined &&
      nowMs - previous.lastPlayableAtMs <= LOADING_GRACE_MS
    ) {
      return {
        desired: { kind: 'set', activity: previous.lastActivity },
        memory: previous,
        reason: 'loading-grace'
      };
    }
    if (!playback.track) return cleared('loading-expired');
  }

  if (playback.state === 'paused' && !settings.showWhenPaused) return cleared('inactive');

  const activity = buildActivity(playback, settings, assets, nowMs);
  const memory: PresenceMemory =
    playback.state === 'playing'
      ? { lastActivity: activity, lastPlayableAtMs: nowMs }
      : { ...previous, lastActivity: activity };
  return {
    desired: { kind: 'set', activity },
    memory,
    reason: playback.state === 'paused' ? 'paused' : 'playing'
  };
}

export function buildActivity(
  playback: PlaybackState,
  settings: Pick<AppSettings, 'showAlbum' | 'showProgress' | 'showZone'>,
  assets: PresenceAssets,
  nowMs: number
): ActivityPayload {
  const stateParts = [playback.artist ?? 'Unknown artist'];
  if (settings.showAlbum && playback.album) stateParts.push(playback.album);
  if (settings.showZone) stateParts.push(playback.zoneName);
  const isPlaying = playback.state === 'playing';
  const timestamps =
    isPlaying && settings.showProgress
      ? calculateTimestamps(nowMs, playback.positionSeconds, playback.durationSeconds)
      : undefined;

  return compactOptional({
    type: 'listening' as const,
    details: truncateDiscordText(playback.track ?? 'Unknown track'),
    state: truncateDiscordText(stateParts.join(' — ')),
    largeImage: assets.artworkUrl ?? assets.fallbackLargeImage,
    largeText: playback.album ? truncateDiscordText(playback.album) : undefined,
    smallImage: assets.smallImage,
    smallText: settings.showZone ? truncateDiscordText(playback.zoneName) : undefined,
    timestamps
  }) as ActivityPayload;
}

export function calculateTimestamps(
  nowMs: number,
  positionSeconds?: number,
  durationSeconds?: number
): { start: number; end?: number } | undefined {
  if (positionSeconds === undefined || !Number.isFinite(positionSeconds) || positionSeconds < 0)
    return undefined;
  const nowSeconds = Math.floor(nowMs / 1_000);
  const start = nowSeconds - Math.floor(positionSeconds);
  if (durationSeconds === undefined || !Number.isFinite(durationSeconds) || durationSeconds <= 0)
    return { start };
  return { start, end: start + Math.floor(durationSeconds) };
}

export function truncateDiscordText(value: string, limit = DISCORD_TEXT_LIMIT): string {
  if (value.length <= limit) return value;
  if (limit <= 1) return '…'.slice(0, limit);
  return `${value.slice(0, limit - 1).trimEnd()}…`;
}

function cleared(reason: PresenceResult['reason']): PresenceResult {
  return { desired: { kind: 'clear' }, memory: {}, reason };
}

function compactOptional<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

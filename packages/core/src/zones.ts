import type { AppSettings, PlaybackState } from './types.js';

/**
 * Automatic selection is sticky while its zone is paused/loading. A new zone is
 * selected only after the old one stops or disappears.
 */
export function selectActiveZone(
  zones: readonly PlaybackState[],
  settings: Pick<AppSettings, 'zoneMode' | 'selectedZoneId'>,
  previousAutomaticZoneId?: string
): PlaybackState | undefined {
  if (settings.zoneMode === 'selected') {
    return zones.find((zone) => zone.zoneId === settings.selectedZoneId);
  }

  const previous = zones.find((zone) => zone.zoneId === previousAutomaticZoneId);
  if (previous && previous.state !== 'stopped') return previous;

  return zones
    .filter((zone) => zone.state === 'playing')
    .sort(
      (left, right) =>
        left.zoneName.localeCompare(right.zoneName) || left.zoneId.localeCompare(right.zoneId)
    )[0];
}

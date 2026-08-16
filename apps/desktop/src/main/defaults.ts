import type { AppSettings } from '../shared/contracts';

export const DEFAULT_SETTINGS: AppSettings = {
  schemaVersion: 1,
  presenceEnabled: true,
  zoneMode: 'selected',
  showAlbum: true,
  showProgress: true,
  showZone: false,
  showWhenPaused: false,
  artworkLookupEnabled: false,
  startAtLogin: false,
  launchHidden: true,
  automaticUpdates: false,
  onboardingComplete: false
};

export function sanitizeSettings(input: unknown): AppSettings {
  if (!input || typeof input !== 'object') return { ...DEFAULT_SETTINGS };
  const value = input as Record<string, unknown>;
  const settings: AppSettings = { ...DEFAULT_SETTINGS };
  const booleans = [
    'presenceEnabled',
    'showAlbum',
    'showProgress',
    'showZone',
    'showWhenPaused',
    'artworkLookupEnabled',
    'startAtLogin',
    'launchHidden',
    'automaticUpdates',
    'onboardingComplete'
  ] as const;
  for (const key of booleans) {
    if (typeof value[key] === 'boolean') settings[key] = value[key];
  }
  // Unsigned beta builds use manual downloads because macOS auto-update
  // verification requires a stable Developer ID signing identity.
  settings.automaticUpdates = false;
  if (value.zoneMode === 'selected' || value.zoneMode === 'automatic') {
    settings.zoneMode = value.zoneMode;
  }
  if (typeof value.selectedZoneId === 'string' && value.selectedZoneId.length <= 256) {
    settings.selectedZoneId = value.selectedZoneId;
  }
  const candidateHost = typeof value.manualRoonHost === 'string' ? value.manualRoonHost.trim() : '';
  if (candidateHost.length > 0 && candidateHost.length <= 253) {
    settings.manualRoonHost = candidateHost;
  }
  if (
    typeof value.manualRoonPort === 'number' &&
    Number.isInteger(value.manualRoonPort) &&
    value.manualRoonPort >= 1 &&
    value.manualRoonPort <= 65535
  ) {
    settings.manualRoonPort = value.manualRoonPort;
  }
  return settings;
}

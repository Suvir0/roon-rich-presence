import type { AppSettings } from './types.js';

export const DEFAULT_SETTINGS: Readonly<AppSettings> = Object.freeze({
  presenceEnabled: true,
  zoneMode: 'selected',
  showAlbum: true,
  showProgress: true,
  showZone: true,
  showWhenPaused: false,
  artworkLookupEnabled: false,
  startAtLogin: false,
  launchHidden: false,
  automaticUpdates: true
});

const BOOLEAN_KEYS = [
  'presenceEnabled',
  'showAlbum',
  'showProgress',
  'showZone',
  'showWhenPaused',
  'artworkLookupEnabled',
  'startAtLogin',
  'launchHidden',
  'automaticUpdates'
] as const satisfies readonly (keyof AppSettings)[];

/** Treat persisted settings as hostile input and retain only known, correctly typed fields. */
export function sanitizeSettings(value: unknown): AppSettings {
  const result: AppSettings = { ...DEFAULT_SETTINGS };
  if (!isRecord(value)) return result;

  for (const key of BOOLEAN_KEYS) {
    if (typeof value[key] === 'boolean') result[key] = value[key];
  }
  if (value.zoneMode === 'selected' || value.zoneMode === 'automatic') {
    result.zoneMode = value.zoneMode;
  }
  if (typeof value.selectedZoneId === 'string' && value.selectedZoneId.trim()) {
    result.selectedZoneId = value.selectedZoneId.trim();
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

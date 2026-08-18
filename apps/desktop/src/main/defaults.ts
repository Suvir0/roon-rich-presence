import type { AppSettings, AppSettingsPatch } from '../shared/contracts';

export const DEFAULT_SETTINGS: AppSettings = {
  schemaVersion: 2,
  theme: 'light',
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
  if (value.theme === 'light' || value.theme === 'dark') {
    settings.theme = value.theme;
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
  // v0.1.1 treated 9330 as a stable default. It is not: Roon advertises its
  // current API port through discovery. Keep a port only when it was explicitly
  // saved by the schema-v2 advanced field.
  if (
    value.schemaVersion === 2 &&
    typeof value.manualRoonPort === 'number' &&
    Number.isInteger(value.manualRoonPort) &&
    value.manualRoonPort >= 1 &&
    value.manualRoonPort <= 65535
  ) {
    settings.manualRoonPort = value.manualRoonPort;
  }
  return settings;
}

const PATCH_BOOLEAN_KEYS = [
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

type PatchValidator = (value: unknown) => boolean;

const PATCH_VALIDATORS: Record<string, PatchValidator> = {
  ...Object.fromEntries(
    PATCH_BOOLEAN_KEYS.map((key) => [key, (value) => typeof value === 'boolean'])
  ),
  theme: (value) => value === 'light' || value === 'dark',
  zoneMode: (value) => value === 'selected' || value === 'automatic',
  selectedZoneId: (value) => typeof value === 'string' && value.length >= 1 && value.length <= 256,
  manualRoonHost: (value) => typeof value === 'string' && value.length <= 253,
  manualRoonPort: (value) =>
    value === null ||
    (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65_535)
};

/** Validates an IPC settings patch against an explicit key allowlist, rejecting unknown keys or wrong types. */
export function parseSettingsPatch(input: unknown): AppSettingsPatch {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Settings patch must be an object');
  }
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    const validate = PATCH_VALIDATORS[key];
    if (!validate) throw new Error(`Unknown settings key: ${key}`);
    if (value === undefined) continue;
    if (!validate(value)) throw new Error(`Invalid value for settings key: ${key}`);
    patch[key] = value;
  }
  return patch as AppSettingsPatch;
}

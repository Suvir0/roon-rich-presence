import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, sanitizeSettings } from './settings.js';

describe('sanitizeSettings', () => {
  it('returns defaults for invalid input', () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings([])).toEqual(DEFAULT_SETTINGS);
  });

  it('accepts known valid fields and drops unknown or mistyped values', () => {
    expect(
      sanitizeSettings({
        presenceEnabled: false,
        zoneMode: 'automatic',
        selectedZoneId: '  kitchen ',
        showAlbum: 'yes',
        malicious: true
      })
    ).toEqual({
      ...DEFAULT_SETTINGS,
      presenceEnabled: false,
      zoneMode: 'automatic',
      selectedZoneId: 'kitchen'
    });
  });
});

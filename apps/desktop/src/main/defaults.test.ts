import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, sanitizeSettings } from './defaults';

describe('sanitizeSettings', () => {
  it('returns defaults for null input', () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it('does not store an empty manualRoonHost', () => {
    const result = sanitizeSettings({ manualRoonHost: '' });
    expect(result.manualRoonHost).toBeUndefined();
  });

  it('does not store a whitespace-only manualRoonHost', () => {
    const result = sanitizeSettings({ manualRoonHost: '   ' });
    expect(result.manualRoonHost).toBeUndefined();
  });

  it('stores a valid manualRoonHost after trimming', () => {
    const result = sanitizeSettings({ manualRoonHost: '  192.168.50.2  ' });
    expect(result.manualRoonHost).toBe('192.168.50.2');
  });

  it('stores a valid manualRoonPort', () => {
    const result = sanitizeSettings({ manualRoonPort: 9330 });
    expect(result.manualRoonPort).toBe(9330);
  });

  it('rejects an out-of-range manualRoonPort', () => {
    expect(sanitizeSettings({ manualRoonPort: 0 }).manualRoonPort).toBeUndefined();
    expect(sanitizeSettings({ manualRoonPort: 65536 }).manualRoonPort).toBeUndefined();
    expect(sanitizeSettings({ manualRoonPort: 1.5 }).manualRoonPort).toBeUndefined();
  });

  it('preserves boolean settings correctly', () => {
    const result = sanitizeSettings({ presenceEnabled: false, showAlbum: true });
    expect(result.presenceEnabled).toBe(false);
    expect(result.showAlbum).toBe(true);
  });

  it('disables automatic updates for unsigned beta builds', () => {
    expect(sanitizeSettings({ automaticUpdates: true }).automaticUpdates).toBe(false);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { configuredIdentityValue, projectIdentity, PROJECT_IDENTITY_DEFAULTS } from './identity';

afterEach(() => vi.unstubAllEnvs());

describe('configuredIdentityValue', () => {
  it('keeps a real configured value', () => {
    expect(configuredIdentityValue('Ada Lovelace', 'fallback')).toBe('Ada Lovelace');
    expect(configuredIdentityValue('  https://example.net/app  ', 'fallback')).toBe(
      'https://example.net/app'
    );
  });

  it('falls back when the value is missing or blank', () => {
    expect(configuredIdentityValue(undefined, 'fallback')).toBe('fallback');
    expect(configuredIdentityValue('   ', 'fallback')).toBe('fallback');
  });

  it('rejects every placeholder the template can leave behind', () => {
    for (const placeholder of [
      'PROJECT_PUBLISHER',
      'PROJECT_CONTACT_URL',
      'PROJECT_SUPPORT_EMAIL',
      'io.github.PROJECT_OWNER.roon-rich-presence',
      'https://github.com/PROJECT_OWNER/roon-rich-presence',
      'support@example.com',
      '<your name>',
      'YOUR_NAME',
      'changeme'
    ]) {
      expect(configuredIdentityValue(placeholder, 'fallback')).toBe('fallback');
    }
  });
});

describe('projectIdentity', () => {
  it('uses the frozen defaults when nothing is configured', () => {
    for (const key of [
      'ROON_EXTENSION_ID',
      'PROJECT_PUBLISHER',
      'PROJECT_SUPPORT_EMAIL',
      'PROJECT_CONTACT_URL'
    ]) {
      vi.stubEnv(key, '');
    }
    expect(projectIdentity()).toEqual(PROJECT_IDENTITY_DEFAULTS);
  });

  it('prefers configured values over the defaults', () => {
    vi.stubEnv('ROON_EXTENSION_ID', 'net.example.custom');
    vi.stubEnv('PROJECT_PUBLISHER', 'Ada Lovelace');
    expect(projectIdentity()).toMatchObject({
      roonExtensionId: 'net.example.custom',
      publisher: 'Ada Lovelace',
      supportEmail: PROJECT_IDENTITY_DEFAULTS.supportEmail
    });
  });

  it('keeps a stale template from changing the Roon extension identity', () => {
    vi.stubEnv('ROON_EXTENSION_ID', 'io.github.PROJECT_OWNER.roon-rich-presence');
    vi.stubEnv('PROJECT_PUBLISHER', 'PROJECT_PUBLISHER');
    vi.stubEnv('PROJECT_SUPPORT_EMAIL', 'support@example.com');
    vi.stubEnv('PROJECT_CONTACT_URL', 'https://github.com/PROJECT_OWNER/roon-rich-presence');
    expect(projectIdentity()).toEqual(PROJECT_IDENTITY_DEFAULTS);
  });
});

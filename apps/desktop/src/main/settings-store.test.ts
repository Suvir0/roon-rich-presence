import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  directory: `/tmp/rrp-settings-${Date.now()}-${Math.random().toString(16).slice(2)}`
}));

vi.mock('electron', () => ({
  app: {
    getPath: () => mocks.directory
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'keychain',
    encryptString: (value: string) => Buffer.from(value, 'utf8').toString('base64'),
    decryptString: (value: Buffer) => Buffer.from(value.toString('utf8'), 'base64').toString('utf8')
  }
}));

import { SettingsStore } from './settings-store';

afterAll(() => rmSync(mocks.directory, { recursive: true, force: true }));

describe('SettingsStore Roon endpoint cache', () => {
  it('persists the last successful endpoint encrypted and clears it with authorization', () => {
    const store = new SettingsStore();
    store.load();
    store.setLastRoonEndpoint({ host: 'roon-server.local', port: 9331 });

    expect(store.getLastRoonEndpoint()).toEqual({ host: 'roon-server.local', port: 9331 });
    const path = join(mocks.directory, 'roon-endpoint.bin');
    expect(readFileSync(path, 'utf8')).not.toContain('"host"');

    store.forgetRoonConnection();
    expect(store.getLastRoonEndpoint()).toBeUndefined();
    expect(existsSync(path)).toBe(false);
  });

  it('rejects malformed endpoints before writing them', () => {
    const store = new SettingsStore();
    expect(() => store.setLastRoonEndpoint({ host: '', port: 9330 })).toThrow(
      'Invalid Roon endpoint'
    );
    expect(() => store.setLastRoonEndpoint({ host: 'roon', port: 0 })).toThrow(
      'Invalid Roon endpoint'
    );
  });
});

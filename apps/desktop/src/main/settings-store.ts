import { app, safeStorage } from 'electron';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { dirname, join } from 'node:path';
import type { AppSettings, AppSettingsPatch, RoonEndpoint } from '../shared/contracts';
import { DEFAULT_SETTINGS, sanitizeSettings } from './defaults';

function atomicWrite(path: string, data: string | Buffer): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, data, { mode: 0o600 });
  chmodSync(temporary, 0o600);
  renameSync(temporary, path);
}

export class SettingsStore {
  private readonly settingsPath = join(app.getPath('userData'), 'settings.json');
  private readonly roonStatePath = join(app.getPath('userData'), 'roon-state.bin');
  private readonly roonEndpointPath = join(app.getPath('userData'), 'roon-endpoint.bin');
  private settings: AppSettings = { ...DEFAULT_SETTINGS };

  load(): AppSettings {
    this.migrateLegacyFiles();
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.settingsPath, 'utf8'));
      this.settings = sanitizeSettings(parsed);
    } catch {
      this.settings = { ...DEFAULT_SETTINGS };
    }
    return this.get();
  }

  get(): AppSettings {
    return { ...this.settings };
  }

  update(patch: AppSettingsPatch): AppSettings {
    this.settings = sanitizeSettings({ ...this.settings, ...patch, schemaVersion: 2 });
    atomicWrite(this.settingsPath, `${JSON.stringify(this.settings, null, 2)}\n`);
    return this.get();
  }

  getSecurityWarning(): string | undefined {
    if (!safeStorage.isEncryptionAvailable()) {
      return 'Secure credential storage is unavailable; Roon authorization will not be persisted.';
    }
    if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') {
      return 'Your Linux secret store is unavailable. Roon authorization is protected only by file permissions.';
    }
    return undefined;
  }

  getRoonState(): Record<string, unknown> {
    if (!existsSync(this.roonStatePath) || !safeStorage.isEncryptionAvailable()) return {};
    try {
      const encrypted = readFileSync(this.roonStatePath);
      const value: unknown = JSON.parse(safeStorage.decryptString(encrypted));
      return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }

  setRoonState(state: Record<string, unknown>): void {
    if (!safeStorage.isEncryptionAvailable()) return;
    atomicWrite(this.roonStatePath, safeStorage.encryptString(JSON.stringify(state)));
  }

  getLastRoonEndpoint(): RoonEndpoint | undefined {
    if (!existsSync(this.roonEndpointPath) || !safeStorage.isEncryptionAvailable())
      return undefined;
    try {
      const encrypted = readFileSync(this.roonEndpointPath);
      const value: unknown = JSON.parse(safeStorage.decryptString(encrypted));
      if (!value || typeof value !== 'object') return undefined;
      const { host, port } = value as Record<string, unknown>;
      return typeof host === 'string' &&
        host.length > 0 &&
        host.length <= 253 &&
        typeof port === 'number' &&
        Number.isInteger(port) &&
        port >= 1 &&
        port <= 65_535
        ? { host, port }
        : undefined;
    } catch {
      return undefined;
    }
  }

  setLastRoonEndpoint(endpoint: RoonEndpoint): void {
    if (!safeStorage.isEncryptionAvailable()) return;
    if (
      !endpoint.host ||
      endpoint.host.length > 253 ||
      !Number.isInteger(endpoint.port) ||
      endpoint.port < 1 ||
      endpoint.port > 65_535
    ) {
      throw new Error('Invalid Roon endpoint');
    }
    atomicWrite(
      this.roonEndpointPath,
      safeStorage.encryptString(JSON.stringify({ host: endpoint.host, port: endpoint.port }))
    );
  }

  forgetRoonState(): void {
    // Missing state is already forgotten; real filesystem failures should reach diagnostics/UI.
    if (existsSync(this.roonStatePath)) unlinkSync(this.roonStatePath);
  }

  forgetRoonConnection(): AppSettings {
    this.forgetRoonState();
    if (existsSync(this.roonEndpointPath)) unlinkSync(this.roonEndpointPath);
    const next = { ...this.settings };
    delete next.manualRoonHost;
    delete next.manualRoonPort;
    this.settings = sanitizeSettings(next);
    atomicWrite(this.settingsPath, `${JSON.stringify(this.settings, null, 2)}\n`);
    return this.get();
  }

  private migrateLegacyFiles(): void {
    const legacyRoot = join(app.getPath('appData'), '@rrp', 'desktop');
    if (legacyRoot === app.getPath('userData')) return;
    mkdirSync(app.getPath('userData'), { recursive: true, mode: 0o700 });
    for (const [name, destination] of [
      ['settings.json', this.settingsPath],
      ['roon-state.bin', this.roonStatePath]
    ] as const) {
      const source = join(legacyRoot, name);
      if (!existsSync(destination) && existsSync(source)) {
        copyFileSync(source, destination);
        chmodSync(destination, 0o600);
      }
    }
  }
}

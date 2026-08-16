import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: () => tmpdir(),
    getVersion: () => 'test',
    isPackaged: false
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    getSelectedStorageBackend: () => 'basic_text'
  }
}));

import { BoundedDiagnosticLog, redactDiagnostic } from './app-controller';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

async function temporaryLogPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'rrp-diagnostics-'));
  temporaryDirectories.push(directory);
  return join(directory, 'main.log');
}

describe('redactDiagnostic', () => {
  it('redacts network locations, URLs, queries, paths, credentials, and identifiers', () => {
    const outputs = [
      'Connecting to roon-server.local:9330 and 192.168.1.24',
      'IPv6 [fe80::1%en0]:9330 or 2001:db8::8',
      'GET https://alice.example.com/private/file?token=super-secret&user=alice',
      'files /Users/alice/Music/Roon/data.json /private/tmp/roon.log C:\\Users\\Alice\\AppData\\Roon\\state.bin',
      'request failed ?user=alice&session=private',
      'token=secret-value Bearer abc.def.ghi',
      'IDs 587227e9-e658-420a-bada-39220eba4b46 1538003707147325546'
    ].map(redactDiagnostic);
    const output = outputs.join(' | ');

    expect(output).toContain('[host]:[port]');
    expect(output).toContain('[ip]');
    expect(output).toContain('[url]');
    expect(output).toContain('[path]');
    expect(output).toContain('token=[redacted]');
    expect(output).toContain('Bearer=[redacted]');
    expect(output).toContain('[id]');
    expect(output).toContain('[application-id]');
    expect(output).not.toMatch(/alice|super-secret|192\.168|fe80|abc\.def|587227e9|1538003/i);
  });

  it('keeps useful non-sensitive failure context', () => {
    expect(redactDiagnostic('Discord bridge exited (code 70); retrying')).toBe(
      'Discord bridge exited (code 70); retrying'
    );
  });
});

describe('BoundedDiagnosticLog', () => {
  it('accounts for an existing file and rotates before an append exceeds the bound', async () => {
    const path = await temporaryLogPath();
    await writeFile(path, 'x'.repeat(60), { mode: 0o644 });
    const log = new BoundedDiagnosticLog(path, 80);

    await log.initialize();
    log.append(`${'new'.repeat(10)}\n`);
    await log.flush();

    expect(await readFile(path, 'utf8')).toBe(`${'new'.repeat(10)}\n`);
    if (process.platform !== 'win32') expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it('serializes rapid writes and leaves bounded private storage', async () => {
    const path = await temporaryLogPath();
    const log = new BoundedDiagnosticLog(path, 96);
    await log.initialize();

    for (let index = 0; index < 20; index += 1)
      log.append(`line-${index.toString().padStart(2, '0')}\n`);
    await log.flush();

    const contents = await readFile(path, 'utf8');
    expect(Buffer.byteLength(contents, 'utf8')).toBeLessThanOrEqual(96);
    expect(contents).toContain('line-19');
    if (process.platform !== 'win32') expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it('truncates an oversized previous-session log during initialization', async () => {
    const path = await temporaryLogPath();
    await writeFile(path, 'old-sensitive-data'.repeat(20));
    const log = new BoundedDiagnosticLog(path, 64);

    await log.initialize();

    expect(await readFile(path, 'utf8')).toBe('');
    if (process.platform !== 'win32') expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it('bounds a single oversized write', async () => {
    const path = await temporaryLogPath();
    const log = new BoundedDiagnosticLog(path, 16);
    await log.initialize();

    log.append('🎵'.repeat(20));
    await log.flush();

    expect(Buffer.byteLength(await readFile(path), 'utf8')).toBeLessThanOrEqual(16);
  });
});

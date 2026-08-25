import { EventEmitter } from 'node:events';
import type { spawn } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/app' }
}));

import { DiscordBridge, type DiscordBridgeSnapshot } from './discord-bridge';

const READY = '{"event":"ready","mode":"discord-social-sdk","connected":false}\n';
const ACTIVITY = {
  kind: 'set' as const,
  activity: { type: 'listening' as const, details: 'Song', state: 'Artist' }
};

interface FakeChild extends EventEmitter {
  stdout: EventEmitter & { setEncoding(encoding: string): void };
  stderr: EventEmitter & { setEncoding(encoding: string): void };
  stdin: { writable: boolean; write(line: string): boolean };
  killed: boolean;
  kill: ReturnType<typeof vi.fn>;
}

function createFakeChild() {
  const written: string[] = [];
  const stream = () => Object.assign(new EventEmitter(), { setEncoding: () => undefined });
  const child = new EventEmitter() as FakeChild;
  child.stdout = stream();
  child.stderr = stream();
  child.stdin = {
    writable: true,
    write: (line: string) => {
      written.push(line);
      return true;
    }
  };
  child.killed = false;
  child.kill = vi.fn(() => {
    child.killed = true;
    return true;
  });
  return { child, written, commands: () => written.map((line) => JSON.parse(line) as object) };
}

function createHarness(options: { executable?: string | undefined } = {}) {
  const executable = 'executable' in options ? options.executable : '/opt/rrp/discord-bridge';
  const children: ReturnType<typeof createFakeChild>[] = [];
  const snapshots: DiscordBridgeSnapshot[] = [];
  const logs: string[] = [];
  const spawns: { executable: string; args: readonly string[] }[] = [];
  const bridge = new DiscordBridge(
    (snapshot) => snapshots.push(snapshot),
    (message) => logs.push(message),
    {
      spawn: ((command: string, args: readonly string[]) => {
        spawns.push({ executable: command, args });
        const fake = createFakeChild();
        children.push(fake);
        return fake.child;
      }) as unknown as typeof spawn,
      resolveExecutable: () => executable
    }
  );
  return {
    bridge,
    children,
    snapshots,
    logs,
    spawns,
    last: () => children[children.length - 1]!,
    status: () => bridge.getSnapshot().status
  };
}

beforeEach(() => vi.stubEnv('DISCORD_APPLICATION_ID', '1234567890123456'));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('DiscordBridge startup', () => {
  it('reports a missing bridge instead of spawning', () => {
    const harness = createHarness({ executable: undefined });
    harness.bridge.start();
    expect(harness.spawns).toHaveLength(0);
    expect(harness.bridge.getSnapshot()).toMatchObject({
      status: 'waiting',
      message: 'Install the official Discord Social SDK bridge to publish presence'
    });
  });

  it('refuses an application id that is not a public numeric identifier', () => {
    vi.stubEnv('DISCORD_APPLICATION_ID', 'not-an-application-id');
    const harness = createHarness();
    harness.bridge.start();
    expect(harness.spawns).toHaveLength(0);
    expect(harness.status()).toBe('error');
  });

  it('passes the configured application id to the executable', () => {
    const harness = createHarness();
    harness.bridge.start();
    expect(harness.spawns).toEqual([
      {
        executable: '/opt/rrp/discord-bridge',
        args: ['--application-id', '1234567890123456']
      }
    ]);
    expect(harness.status()).toBe('searching');
  });

  it('does not spawn a second process while one is running', () => {
    const harness = createHarness();
    harness.bridge.start();
    harness.bridge.start();
    expect(harness.spawns).toHaveLength(1);
  });
});

describe('DiscordBridge backend verification', () => {
  it('refuses to publish through a development stub', () => {
    const harness = createHarness();
    harness.bridge.start();
    harness.last().child.stdout.emit('data', '{"event":"ready","mode":"stub"}\n');
    expect(harness.bridge.getSnapshot()).toEqual({
      status: 'error',
      message: 'A development Discord stub is installed; build the official Social SDK bridge'
    });
  });

  it('refuses to publish through an unrecognized backend', () => {
    const harness = createHarness();
    harness.bridge.start();
    harness.last().child.stdout.emit('data', '{"event":"ready","mode":"something-else"}\n');
    expect(harness.status()).toBe('error');
  });

  it('republishes the desired activity once the official backend is ready', () => {
    const harness = createHarness();
    harness.bridge.start();
    harness.bridge.setPresence(ACTIVITY);
    harness.last().child.stdout.emit('data', READY);
    expect(harness.last().commands()).toEqual([
      { command: 'set_activity', details: 'Song', state: 'Artist' },
      { command: 'set_activity', details: 'Song', state: 'Artist' }
    ]);
  });

  it('treats a confirmed clear as proof the production bridge works', () => {
    const harness = createHarness();
    harness.bridge.start();
    harness.last().child.stdout.emit('data', READY);
    harness.last().child.stdout.emit('data', '{"event":"status","operation":"clear","ok":true}\n');
    expect(harness.bridge.getSnapshot()).toEqual({
      status: 'connected',
      message: 'Official Discord bridge is ready; waiting for playback'
    });
  });

  it('keeps a confirmed connection through later activity updates', () => {
    const harness = createHarness();
    harness.bridge.start();
    const { stdout } = harness.last().child;
    stdout.emit('data', '{"event":"ready","mode":"discord-social-sdk","connected":true}\n');
    expect(harness.status()).toBe('connected');
    stdout.emit('data', '{"event":"status","operation":"set_activity","ok":true}\n');
    expect(harness.status()).toBe('connected');
  });

  it('surfaces a rejected operation and a lost client', () => {
    const harness = createHarness();
    harness.bridge.start();
    const { stdout } = harness.last().child;
    stdout.emit('data', READY);
    stdout.emit(
      'data',
      '{"event":"status","ok":false,"message":"Discord rejected the activity"}\n'
    );
    expect(harness.bridge.getSnapshot()).toEqual({
      status: 'error',
      message: 'Discord rejected the activity'
    });
    stdout.emit('data', '{"event":"disconnected","message":"Discord closed"}\n');
    expect(harness.bridge.getSnapshot()).toEqual({
      status: 'waiting',
      message: 'Discord closed'
    });
  });
});

describe('DiscordBridge stream framing', () => {
  it('reassembles a message split across chunks', () => {
    const harness = createHarness();
    harness.bridge.start();
    const { stdout } = harness.last().child;
    stdout.emit('data', '{"event":"ready","mode":"discord-soc');
    expect(harness.status()).toBe('searching');
    stdout.emit('data', 'ial-sdk","connected":true}\n');
    expect(harness.status()).toBe('connected');
  });

  it('handles several messages arriving in one chunk', () => {
    const harness = createHarness();
    harness.bridge.start();
    harness.last().child.stdout.emit('data', `${READY}{"event":"connected"}\n`);
    expect(harness.status()).toBe('connected');
  });

  it('survives malformed output', () => {
    const harness = createHarness();
    harness.bridge.start();
    const { stdout } = harness.last().child;
    stdout.emit('data', 'not json\n');
    expect(harness.logs).toContain('Discarded malformed Discord bridge output');
    stdout.emit('data', READY);
    expect(harness.bridge.getSnapshot().status).not.toBe('error');
  });

  it('discards a line that never terminates and recovers on the next one', () => {
    const harness = createHarness();
    harness.bridge.start();
    const { stdout } = harness.last().child;
    stdout.emit('data', 'x'.repeat(33 * 1_024));
    expect(harness.logs).toContain('Discarded oversized Discord bridge output');
    stdout.emit('data', READY);
    expect(harness.status()).toBe('connected');
  });

  it('blocks an oversized command instead of writing it', () => {
    const harness = createHarness();
    harness.bridge.start();
    harness.bridge.setPresence({
      kind: 'set',
      activity: { type: 'listening', details: 'x'.repeat(17 * 1_024) }
    });
    expect(harness.last().written).toEqual([]);
    expect(harness.logs).toContain('Blocked an oversized Discord bridge command');
  });

  it('logs bridge diagnostics written to stderr', () => {
    const harness = createHarness();
    harness.bridge.start();
    harness.last().child.stderr.emit('data', '  backend warning  ');
    expect(harness.logs).toContain('Discord bridge: backend warning');
  });
});

describe('DiscordBridge lifecycle', () => {
  it('restarts with a growing delay after the process exits', () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const harness = createHarness();
    harness.bridge.start();
    harness.last().child.emit('exit', 1, null);
    expect(harness.status()).toBe('waiting');

    vi.advanceTimersByTime(999);
    expect(harness.spawns).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(harness.spawns).toHaveLength(2);

    harness.last().child.emit('exit', 1, null);
    vi.advanceTimersByTime(1_999);
    expect(harness.spawns).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(harness.spawns).toHaveLength(3);
  });

  it('restarts from the shortest delay again once a ready backend is seen', () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const harness = createHarness();
    harness.bridge.start();
    harness.last().child.emit('exit', 1, null);
    vi.advanceTimersByTime(1_000);
    harness.last().child.stdout.emit('data', READY);
    harness.last().child.emit('exit', 1, null);

    vi.advanceTimersByTime(1_000);
    expect(harness.spawns).toHaveLength(3);
  });

  it('reports a process that never started', () => {
    vi.useFakeTimers();
    const harness = createHarness();
    harness.bridge.start();
    harness.last().child.emit('error', new Error('spawn EACCES'));
    expect(harness.status()).toBe('waiting');
    expect(harness.logs.some((line) => line.includes('failed to start'))).toBe(true);
  });

  it('clears the activity and force-kills a bridge that ignores shutdown', () => {
    vi.useFakeTimers();
    const harness = createHarness();
    harness.bridge.start();
    const child = harness.last();
    harness.bridge.stop();

    expect(child.commands()).toEqual([{ command: 'clear' }, { command: 'shutdown' }]);
    expect(child.child.kill).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_500);
    expect(child.child.kill).toHaveBeenCalledTimes(1);
    expect(harness.bridge.getSnapshot()).toEqual({
      status: 'idle',
      message: 'Discord presence stopped'
    });
  });

  it('does not restart or respawn after stop', () => {
    vi.useFakeTimers();
    const harness = createHarness();
    harness.bridge.start();
    const child = harness.last();
    harness.bridge.stop();
    child.child.emit('exit', 0, null);
    vi.advanceTimersByTime(60_000);
    harness.bridge.start();
    expect(harness.spawns).toHaveLength(1);
  });
});

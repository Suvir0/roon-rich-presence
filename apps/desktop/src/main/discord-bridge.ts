import { app } from 'electron';
import { existsSync, lstatSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { DesiredPresence } from '@rrp/core';
import type { ConnectionStatus } from '../shared/contracts';

const MAX_LINE_BYTES = 16 * 1_024;
const MAX_RESTART_DELAY = 60_000;
const DEFAULT_DISCORD_APPLICATION_ID = '1538003707147325546';

export interface DiscordBridgeSnapshot {
  status: ConnectionStatus;
  message: string;
}

export class DiscordBridge {
  private child: ChildProcessWithoutNullStreams | undefined;
  private stopping = false;
  private restartAttempt = 0;
  private restartTimer?: NodeJS.Timeout;
  private buffer = '';
  private bridgeReady = false;
  private desired: DesiredPresence = { kind: 'clear' };
  private snapshot: DiscordBridgeSnapshot = {
    status: 'idle',
    message: 'Discord bridge has not started'
  };

  constructor(
    private readonly onChange: (snapshot: DiscordBridgeSnapshot) => void,
    private readonly log: (message: string) => void
  ) {}

  start(): void {
    if (this.child || this.stopping) return;
    const executable = this.resolveExecutable();
    if (!executable) {
      this.setSnapshot({
        status: 'waiting',
        message: 'Install the official Discord Social SDK bridge to publish presence'
      });
      return;
    }
    const applicationId =
      process.env.DISCORD_APPLICATION_ID?.trim() || DEFAULT_DISCORD_APPLICATION_ID;
    if (!applicationId || !/^\d{16,22}$/.test(applicationId)) {
      this.setSnapshot({
        status: 'error',
        message: 'A valid public Discord Application ID is required'
      });
      return;
    }
    this.setSnapshot({ status: 'searching', message: 'Connecting to the Discord desktop client…' });
    const child = spawn(executable, ['--application-id', applicationId], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, DISCORD_APPLICATION_ID: applicationId }
    });
    this.child = child;
    this.bridgeReady = false;
    this.buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.handleOutput(chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) =>
      this.log(`Discord bridge: ${chunk.trim().slice(0, 500)}`)
    );
    child.once('error', (error) => this.handleExit(`failed to start: ${error.message}`));
    child.once('exit', (code, signal) =>
      this.handleExit(`exited (${code ?? signal ?? 'unknown'})`)
    );
  }

  setPresence(desired: DesiredPresence): void {
    this.desired = desired;
    if (desired.kind === 'clear') {
      this.write({ command: 'clear' });
      return;
    }
    const activity = desired.activity;
    this.write({
      command: 'set_activity',
      details: activity.details,
      ...(activity.state ? { state: activity.state } : {}),
      ...(activity.largeImage ? { large_image: activity.largeImage } : {}),
      ...(activity.largeText ? { large_text: activity.largeText } : {}),
      ...(activity.smallImage ? { small_image: activity.smallImage } : {}),
      ...(activity.smallText ? { small_text: activity.smallText } : {}),
      ...(activity.timestamps?.start !== undefined
        ? { start_timestamp: activity.timestamps.start }
        : {}),
      ...(activity.timestamps?.end !== undefined ? { end_timestamp: activity.timestamps.end } : {})
    });
  }

  getSnapshot(): DiscordBridgeSnapshot {
    return { ...this.snapshot };
  }

  stop(): void {
    this.stopping = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.write({ command: 'clear' });
    this.write({ command: 'shutdown' });
    const child = this.child;
    this.child = undefined;
    this.bridgeReady = false;
    if (child && !child.killed) {
      const forceTimer = setTimeout(() => child.kill(), 1_500);
      forceTimer.unref();
    }
    this.setSnapshot({ status: 'idle', message: 'Discord presence stopped' });
  }

  private resolveExecutable(): string | undefined {
    const override = process.env.DISCORD_BRIDGE_PATH;
    if (!app.isPackaged && override && isAbsolute(override) && isRegularFile(override)) {
      return override;
    }
    const name = process.platform === 'win32' ? 'discord-bridge.exe' : 'discord-bridge';
    const candidates = app.isPackaged
      ? [join(process.resourcesPath, 'discord-bridge', name)]
      : [
          resolve(app.getAppPath(), '../../native/discord-bridge/build', name),
          resolve(app.getAppPath(), '../../native/discord-bridge/build/Release', name)
        ];
    return candidates.find((candidate) => isRegularFile(candidate));
  }

  private write(payload: object): void {
    if (!this.child?.stdin.writable) return;
    const line = JSON.stringify(payload);
    if (Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES) {
      this.log('Blocked an oversized Discord bridge command');
      return;
    }
    this.child.stdin.write(`${line}\n`);
  }

  private handleOutput(chunk: string): void {
    this.buffer += chunk;
    if (Buffer.byteLength(this.buffer, 'utf8') > MAX_LINE_BYTES * 2) {
      this.buffer = '';
      this.log('Discarded oversized Discord bridge output');
      return;
    }
    let newline = this.buffer.indexOf('\n');
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line) this.handleLine(line);
      newline = this.buffer.indexOf('\n');
    }
  }

  private handleLine(line: string): void {
    try {
      const message: unknown = JSON.parse(line);
      if (!message || typeof message !== 'object') return;
      const value = message as {
        event?: unknown;
        message?: unknown;
        connected?: unknown;
        ok?: unknown;
        operation?: unknown;
        mode?: unknown;
      };
      const text = typeof value.message === 'string' ? value.message.slice(0, 300) : '';
      if (value.event === 'ready') {
        this.restartAttempt = 0;
        const mode = typeof value.mode === 'string' ? value.mode.slice(0, 80) : 'unknown';
        if (mode !== 'discord-social-sdk') {
          this.bridgeReady = false;
          this.setSnapshot({
            status: 'error',
            message:
              mode === 'stub'
                ? 'A development Discord stub is installed; build the official Social SDK bridge'
                : 'The Discord bridge could not verify its production backend'
          });
          return;
        }
        this.bridgeReady = true;
        this.setSnapshot({
          status:
            value.connected === true || this.desired.kind === 'clear' ? 'connected' : 'searching',
          message:
            value.connected === true
              ? text || 'Discord desktop is connected through the official bridge'
              : this.desired.kind === 'clear'
                ? 'Official Discord bridge is ready; playback will verify the desktop client'
                : 'Official bridge is ready; publishing activity to Discord…'
        });
        this.setPresence(this.desired);
      } else if (value.event === 'connected') {
        this.restartAttempt = 0;
        this.setSnapshot({
          status: 'connected',
          message: text || 'Discord desktop is connected through the official bridge'
        });
      } else if (value.event === 'waiting' || value.event === 'disconnected') {
        this.setSnapshot({ status: 'waiting', message: text || 'Waiting for Discord desktop' });
      } else if (value.event === 'status') {
        const operation = typeof value.operation === 'string' ? value.operation : '';
        if (value.ok === false) {
          this.setSnapshot({ status: 'error', message: text || 'Discord rejected the operation' });
        } else if (value.connected === true) {
          this.setSnapshot({ status: 'connected', message: text || 'Discord presence updated' });
        } else if (operation === 'clear' && this.bridgeReady) {
          // Clear cannot establish a client connection; it only proves the production bridge works.
          this.setSnapshot({
            status: 'connected',
            message: 'Official Discord bridge is ready; waiting for playback'
          });
        } else if (operation === 'set_activity' && this.bridgeReady) {
          // Stay 'connected' if Discord already confirmed a previous activity so the UI
          // does not flash back to a disconnected-looking state on every track change.
          const alreadyConnected = this.snapshot.status === 'connected';
          this.setSnapshot({
            status: alreadyConnected ? 'connected' : 'searching',
            message: alreadyConnected
              ? text || 'Updating Discord presence\u2026'
              : text || 'Activity queued; waiting for Discord confirmation\u2026'
          });
        } else {
          this.setSnapshot({
            status: 'waiting',
            message: text || 'Discord desktop is unavailable'
          });
        }
      } else if (value.event === 'error') {
        this.setSnapshot({ status: 'error', message: text || 'Discord bridge reported an error' });
      }
    } catch {
      this.log('Discarded malformed Discord bridge output');
    }
  }

  private handleExit(reason: string): void {
    if (!this.child) return;
    this.child = undefined;
    this.bridgeReady = false;
    this.log(`Discord bridge ${reason}`);
    if (this.stopping) return;
    this.setSnapshot({ status: 'waiting', message: 'Discord bridge disconnected; retrying…' });
    const delay = Math.min(MAX_RESTART_DELAY, 1_000 * 2 ** Math.min(this.restartAttempt, 6));
    this.restartAttempt += 1;
    this.restartTimer = setTimeout(() => this.start(), delay + Math.floor(Math.random() * 500));
    this.restartTimer.unref();
  }

  private setSnapshot(snapshot: DiscordBridgeSnapshot): void {
    this.snapshot = snapshot;
    this.onChange(this.getSnapshot());
  }
}

function isRegularFile(path: string): boolean {
  if (!existsSync(path)) return false;
  try {
    const information = lstatSync(path);
    return information.isFile() && !information.isSymbolicLink();
  } catch {
    return false;
  }
}

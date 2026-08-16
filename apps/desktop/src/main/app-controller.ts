import { app } from 'electron';
import {
  EMPTY_THROTTLE_STATE,
  flushPendingPresence,
  mapPresence,
  planPresenceUpdate,
  selectActiveZone,
  type PresenceMemory,
  type UpdateThrottleState
} from '@rrp/core';
import { appendFile, chmod, mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type {
  AppSettings,
  AppSnapshot,
  PlaybackState,
  PresencePreview,
  ZoneSummary
} from '../shared/contracts';
import { ArtworkService } from './artwork-service';
import { DiscordBridge, type DiscordBridgeSnapshot } from './discord-bridge';
import { RoonService, type RoonServiceSnapshot } from './roon-service';
import { SettingsStore } from './settings-store';

const MAX_DIAGNOSTICS = 100;
const FORGET_DEBOUNCE_MS = 1_500;
// Rotate the log file when it grows beyond this size (bytes) to keep it bounded.
const LOG_MAX_BYTES = 512_000;

const URL_PATTERN = /\b[a-z][a-z\d+.-]*:\/\/[^\s<>'"`]+/gi;
const WINDOWS_PATH_PATTERN = /(?:\b[A-Za-z]:\\|\\\\)[^\r\n<>|"`]+/g;
const HOME_PATH_PATTERN = /(?:^|\s)(?:~\/|\/(?:Users|home)\/[^/\s]+\/)[^\s<>"`|,;]*/g;
const ABSOLUTE_PATH_PATTERN = /(?:^|\s)\/(?!\/)[^\s<>"`|,;]*/g;
const HOST_AND_PORT_PATTERN =
  /\b(?:[a-z\d](?:[a-z\d.-]*[a-z\d])?|\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}\b/gi;
const BRACKETED_IPV6_PATTERN = /\[[0-9a-f:]+(?:%[a-z\d._-]+)?\](?::\d{1,5})?/gi;
const IPV4_PATTERN = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const IPV6_PATTERN =
  /(?<![a-z\d])(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}(?:%[a-z\d._-]+)?(?![a-z\d])/gi;
const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi;
const APPLICATION_ID_PATTERN = /\b\d{16,22}\b/g;
const SECRET_ASSIGNMENT_PATTERN =
  /\b(authorization|bearer|token|access[_-]?token|refresh[_-]?token|api[_-]?key|secret|password)\b(\s*[:=]\s*|\s+)([^\s,;]+)/gi;
const QUERY_PATTERN = /\?[A-Za-z0-9%_.~!$&'()*+,;=:@/?-]+/g;

/** Removes local-network, filesystem, and credential-like values before diagnostics leave memory. */
export function redactDiagnostic(value: string): string {
  return value
    .replace(URL_PATTERN, '[url]')
    .replace(WINDOWS_PATH_PATTERN, '[path]')
    .replace(HOME_PATH_PATTERN, (match) => `${match.startsWith(' ') ? ' ' : ''}[path]`)
    .replace(ABSOLUTE_PATH_PATTERN, (match) => `${match.startsWith(' ') ? ' ' : ''}[path]`)
    .replace(BRACKETED_IPV6_PATTERN, '[ip]')
    .replace(HOST_AND_PORT_PATTERN, '[host]:[port]')
    .replace(IPV4_PATTERN, '[ip]')
    .replace(IPV6_PATTERN, '[ip]')
    .replace(SECRET_ASSIGNMENT_PATTERN, (_match, name: string) => `${name}=[redacted]`)
    .replace(UUID_PATTERN, '[id]')
    .replace(APPLICATION_ID_PATTERN, '[application-id]')
    .replace(QUERY_PATTERN, '?[query]')
    .slice(0, 500);
}

/** Serializes bounded log writes so rotation cannot race with an append. */
export class BoundedDiagnosticLog {
  private byteCount = 0;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly path: string,
    private readonly maximumBytes = LOG_MAX_BYTES
  ) {}

  async initialize(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    try {
      const information = await stat(this.path);
      this.byteCount = information.size;
      await chmod(this.path, 0o600);
      if (this.byteCount > this.maximumBytes) {
        await writeFile(this.path, '', { mode: 0o600 });
        this.byteCount = 0;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      this.byteCount = 0;
    }
  }

  append(line: string): void {
    const boundedLine = this.boundLine(line);
    const bytes = Buffer.byteLength(boundedLine, 'utf8');
    this.queue = this.queue
      .then(async () => {
        if (this.byteCount + bytes > this.maximumBytes) {
          await writeFile(this.path, boundedLine, { mode: 0o600 });
          this.byteCount = bytes;
        } else {
          await appendFile(this.path, boundedLine, { mode: 0o600 });
          this.byteCount += bytes;
        }
        await chmod(this.path, 0o600);
      })
      .catch(() => undefined);
  }

  flush(): Promise<void> {
    return this.queue;
  }

  private boundLine(line: string): string {
    if (Buffer.byteLength(line, 'utf8') <= this.maximumBytes) return line;
    let end = Math.min(line.length, this.maximumBytes);
    while (end > 0 && Buffer.byteLength(line.slice(0, end), 'utf8') > this.maximumBytes) end -= 1;
    return line.slice(0, end);
  }
}

export class AppController {
  readonly settingsStore = new SettingsStore();
  readonly artwork = new ArtworkService();
  readonly discord = new DiscordBridge(
    (snapshot) => this.handleDiscord(snapshot),
    (message) => this.log(message)
  );
  readonly roon = new RoonService(
    this.settingsStore,
    (snapshot) => this.handleRoon(snapshot),
    (message) => this.log(message)
  );

  private settings!: AppSettings;
  private roonSnapshot: RoonServiceSnapshot = this.roon.getSnapshot();
  private discordSnapshot: DiscordBridgeSnapshot = this.discord.getSnapshot();
  private playback: PlaybackState | undefined;
  private activeZoneId: string | undefined;
  private automaticZoneId: string | undefined;
  private artworkUrl: string | undefined;
  private lastPreviewArtworkUrl: string | undefined;
  private artworkKey: string | undefined;
  private artworkGeneration = 0;
  private artworkState: AppSnapshot['artwork'] = {
    status: 'idle',
    message: 'Artwork matching is off; enable Find album covers to use public cover art'
  };
  private presence: PresencePreview | undefined;
  private presenceMemory: PresenceMemory = {};
  private throttle: UpdateThrottleState = EMPTY_THROTTLE_STATE;
  private throttleTimer?: NodeJS.Timeout;
  private diagnostics: string[] = [];
  private listeners = new Set<(snapshot: AppSnapshot) => void>();
  private lastForgetAt = 0;
  private readonly logPath = join(app.getPath('userData'), 'main.log');
  private readonly diagnosticLog = new BoundedDiagnosticLog(this.logPath);

  async initialize(): Promise<void> {
    this.settings = this.settingsStore.load();
    // Logging must never prevent the app from reaching the UI.
    await this.diagnosticLog.initialize().catch(() => undefined);
    await this.artwork.initialize();
    this.applyLoginItemSettings();
    const manual = this.getManualRoonAddress();
    this.roon.start(manual);
    this.discord.start();
    this.log('Application services initialized');
    this.reconcile();
  }

  subscribe(listener: (snapshot: AppSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): AppSnapshot {
    const zones: ZoneSummary[] = this.roonSnapshot.zones.map((zone) => ({
      id: zone.zoneId,
      name: zone.zoneName,
      state: zone.state
    }));
    const securityWarning = this.settingsStore.getSecurityWarning();
    const cover = this.artworkUrl ?? this.lastPreviewArtworkUrl;
    return {
      version: app.getVersion(),
      settings: { ...this.settings },
      ...(this.playback
        ? {
            playback: {
              ...this.playback,
              ...(cover ? { artworkUrl: cover } : {})
            }
          }
        : {}),
      zones,
      ...(this.activeZoneId ? { activeZoneId: this.activeZoneId } : {}),
      ...(this.presence ? { presence: { ...this.presence } } : {}),
      roon: {
        status: this.roonSnapshot.status,
        message: this.roonSnapshot.message,
        ...(this.roonSnapshot.serverName ? { serverName: this.roonSnapshot.serverName } : {})
      },
      discord: { ...this.discordSnapshot },
      artwork: { ...this.artworkState },
      ...(securityWarning ? { securityWarning } : {}),
      diagnostics: [...this.diagnostics]
    };
  }

  updateSettings(patch: Partial<AppSettings>): AppSnapshot {
    const oldManual = this.getManualRoonAddress();
    this.settings = this.settingsStore.update(patch);
    this.applyLoginItemSettings();
    if (patch.zoneMode === 'automatic' || patch.zoneMode === 'selected') {
      this.automaticZoneId = undefined;
    }
    const nextManual = this.getManualRoonAddress();
    if (JSON.stringify(oldManual) !== JSON.stringify(nextManual)) this.roon.restart(nextManual);
    this.reconcile();
    return this.getSnapshot();
  }

  completeOnboarding(): AppSnapshot {
    return this.updateSettings({ onboardingComplete: true });
  }

  forgetRoon(): AppSnapshot {
    const now = Date.now();
    if (now - this.lastForgetAt < FORGET_DEBOUNCE_MS) return this.getSnapshot();
    this.lastForgetAt = now;

    // Stop first so a closing legacy connection cannot write its authorization back.
    this.roon.stop();
    this.settings = this.settingsStore.forgetRoonConnection();
    this.automaticZoneId = undefined;
    this.presenceMemory = {};
    this.roon.start();
    this.log('Roon authorization and manual server override were forgotten');
    return this.getSnapshot();
  }

  getRedactedDiagnostics(): string {
    const snapshot = this.getSnapshot();
    return [
      `Roon Rich Presence ${snapshot.version}`,
      `Platform: ${process.platform}/${process.arch}`,
      `Roon: ${snapshot.roon.status} — ${snapshot.roon.message}`,
      `Discord: ${snapshot.discord.status} — ${snapshot.discord.message}`,
      `Artwork: ${snapshot.artwork.status} — ${snapshot.artwork.message}`,
      `Zones discovered: ${snapshot.zones.length}`,
      `Secure storage warning: ${snapshot.securityWarning ? 'yes' : 'no'}`,
      '',
      ...this.diagnostics
    ]
      .map(redactDiagnostic)
      .join('\n');
  }

  shutdown(): void {
    if (this.throttleTimer) clearTimeout(this.throttleTimer);
    this.discord.stop();
    this.roon.stop();
  }

  private handleRoon(snapshot: RoonServiceSnapshot): void {
    this.roonSnapshot = snapshot;
    this.reconcile();
  }

  private handleDiscord(snapshot: DiscordBridgeSnapshot): void {
    this.discordSnapshot = snapshot;
    this.emit();
  }

  private reconcile(): void {
    if (!this.settings) return;
    const selected = selectActiveZone(this.roonSnapshot.zones, this.settings, this.automaticZoneId);
    if (this.settings.zoneMode === 'automatic' && selected) this.automaticZoneId = selected.zoneId;
    this.playback = selected;
    this.activeZoneId = selected?.zoneId;

    const nextArtworkKey =
      this.settings.artworkLookupEnabled && selected?.artist && selected.album
        ? `${selected.artist}\u0000${selected.album}`
        : undefined;
    if (nextArtworkKey !== this.artworkKey) {
      this.artworkKey = nextArtworkKey;
      this.lastPreviewArtworkUrl = this.artworkUrl ?? this.lastPreviewArtworkUrl;
      this.artworkUrl = undefined;
      this.artworkGeneration += 1;
      const generation = this.artworkGeneration;
      if (nextArtworkKey && selected) {
        this.artworkState = {
          status: 'searching',
          message: 'Matching this release with MusicBrainz…'
        };
        void this.artwork
          .resolve(selected.artist, selected.album)
          .then((result) => {
            if (generation !== this.artworkGeneration) return;
            this.artworkUrl = result.status === 'matched' ? result.url : undefined;
            this.lastPreviewArtworkUrl = this.artworkUrl;
            this.artworkState =
              result.status === 'matched'
                ? {
                    status: 'connected',
                    message: 'Matched and verified through Cover Art Archive',
                    url: result.url
                  }
                : result.status === 'error'
                  ? { status: 'error', message: `${result.message}. Retry on the next track.` }
                  : { status: 'waiting', message: `${result.message}; using branded fallback` };
            this.publishPresence();
            this.emit();
          })
          .catch((error: unknown) => {
            if (generation !== this.artworkGeneration) return;
            this.artworkUrl = undefined;
            this.lastPreviewArtworkUrl = undefined;
            this.artworkState = {
              status: 'error',
              message: 'Artwork lookup failed; using branded fallback. Retry on the next track.'
            };
            this.log(
              `Artwork lookup failed: ${error instanceof Error ? error.message : 'unknown error'}`
            );
            this.publishPresence();
            this.emit();
          });
      } else {
        this.artworkUrl = undefined;
        this.lastPreviewArtworkUrl = undefined;
        this.artworkState = this.settings.artworkLookupEnabled
          ? { status: 'waiting', message: 'Artist and album are needed to match artwork' }
          : {
              status: 'idle',
              message: 'Artwork matching is off; enable Find album covers to use public cover art'
            };
      }
    }
    this.publishPresence();
    this.emit();
  }

  private publishPresence(): void {
    const result = mapPresence(
      this.playback,
      this.settings,
      {
        ...(this.artworkUrl ? { artworkUrl: this.artworkUrl } : {}),
        ...(process.env.DISCORD_LARGE_IMAGE_KEY?.trim()
          ? { fallbackLargeImage: process.env.DISCORD_LARGE_IMAGE_KEY.trim() }
          : {}),
        ...(process.env.DISCORD_SMALL_IMAGE_KEY?.trim()
          ? { smallImage: process.env.DISCORD_SMALL_IMAGE_KEY.trim() }
          : {})
      },
      Date.now(),
      this.presenceMemory
    );
    this.presenceMemory = result.memory;
    this.presence =
      result.desired.kind === 'set'
        ? {
            details: result.desired.activity.details,
            ...(result.desired.activity.state ? { state: result.desired.activity.state } : {}),
            ...(result.desired.activity.largeImage
              ? { largeImage: result.desired.activity.largeImage }
              : {}),
            ...(result.desired.activity.largeText
              ? { largeText: result.desired.activity.largeText }
              : {}),
            ...(result.desired.activity.smallText
              ? { smallText: result.desired.activity.smallText }
              : {}),
            ...(result.desired.activity.timestamps
              ? {
                  startTimestamp: result.desired.activity.timestamps.start,
                  ...(result.desired.activity.timestamps.end
                    ? { endTimestamp: result.desired.activity.timestamps.end }
                    : {})
                }
              : {}),
            paused: this.playback?.state === 'paused'
          }
        : undefined;

    const planned = planPresenceUpdate(this.throttle, result.desired, Date.now());
    this.throttle = planned.state;
    if (planned.dispatch) this.discord.setPresence(planned.dispatch);
    if (this.throttleTimer) clearTimeout(this.throttleTimer);
    if (planned.nextEligibleAtMs) {
      this.throttleTimer = setTimeout(
        () => {
          const flushed = flushPendingPresence(this.throttle, Date.now());
          this.throttle = flushed.state;
          if (flushed.dispatch) this.discord.setPresence(flushed.dispatch);
        },
        Math.max(0, planned.nextEligibleAtMs - Date.now())
      );
      this.throttleTimer.unref();
    }
  }

  private applyLoginItemSettings(): void {
    if (!app.isPackaged) return;
    const current = app.getLoginItemSettings();
    if (
      current.openAtLogin === this.settings.startAtLogin &&
      (!this.settings.startAtLogin || current.openAsHidden === this.settings.launchHidden)
    ) {
      return;
    }
    app.setLoginItemSettings({
      openAtLogin: this.settings.startAtLogin,
      openAsHidden: this.settings.launchHidden
    });
  }

  private getManualRoonAddress(): { host: string; port: number } | undefined {
    return this.settings?.manualRoonHost && this.settings.manualRoonPort
      ? { host: this.settings.manualRoonHost, port: this.settings.manualRoonPort }
      : undefined;
  }

  private log(message: string): void {
    const safe = redactDiagnostic(message);
    this.diagnostics.push(`${new Date().toISOString()} ${safe}`);
    if (this.diagnostics.length > MAX_DIAGNOSTICS) this.diagnostics.shift();
    this.diagnosticLog.append(`${new Date().toISOString()} ${safe}\n`);
    this.emit();
  }

  private emit(): void {
    if (!this.settings) return;
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}

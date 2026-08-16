import { app } from 'electron';
import { createRequire } from 'node:module';
import { createConnection } from 'node:net';
import { reduceZoneEvent, type PlaybackState, type RoonZone, type ZoneMap } from '@rrp/core';
import type { ConnectionStatus } from '../shared/contracts';
import type { SettingsStore } from './settings-store';

const require = createRequire(import.meta.url);
const RoonApi = require('node-roon-api') as new (
  options: Record<string, unknown>
) => RoonApiInstance;
const RoonApiTransport = require('node-roon-api-transport') as RoonServiceConstructor;
const RoonApiImage = require('node-roon-api-image') as RoonServiceConstructor;
const RoonApiStatus = require('node-roon-api-status') as new (roon: RoonApiInstance) => {
  services: unknown[];
  set_status(message: string, isError: boolean): void;
};

// Loopback ports to probe before SOOD discovery. Loopback bypasses macOS Local Network
// TCC entirely, so connecting to a Roon Server on the same Mac works from Finder too.
const LOOPBACK_PORTS: readonly number[] = [9330];

// After this many ms without a loopback pairing, start SOOD discovery so that the two
// discovery paths never race to the same Core simultaneously.
const LOOPBACK_TIMEOUT_MS = 1_500;

// Show a platform-specific hint after this many ms of still searching.
const SEARCH_HINT_MS = 12_000;

// Give Roon Core a brief window to drop the previous extension session before we
// open a new one. Without this, a restart with the same extension_id is rejected.
const RESTART_DELAY_MS = 400;

interface RoonServiceConstructor {
  new (...args: unknown[]): unknown;
}

interface RoonTransport {
  subscribe_zones(callback: (response: string, body: Record<string, unknown>) => void): void;
}

interface RoonCore {
  display_name?: string;
  services: { RoonApiTransport?: RoonTransport };
}

interface RoonTransportObject {
  close(): void;
  onopen: () => void;
  onclose: () => void;
  onerror: (err?: unknown) => void;
  _isonopencalled?: boolean;
}

interface RoonApiInstance {
  init_services(options: {
    required_services: unknown[];
    optional_services?: unknown[];
    provided_services: unknown[];
  }): void;
  start_discovery(): void;
  stop_discovery?(): void;
  disconnect_all?(): void;
  ws_connect?(options: {
    host: string;
    port: number;
    onclose?: () => void;
    onerror?: () => void;
  }): RoonConnection;
}

interface RoonConnection {
  transport?: RoonTransportObject;
}

export interface RoonServiceSnapshot {
  status: ConnectionStatus;
  message: string;
  serverName: string | undefined;
  zones: PlaybackState[];
}

export class RoonService {
  private roon: RoonApiInstance | undefined;
  private manualConn: RoonConnection | undefined;
  private retryTimer: NodeJS.Timeout | undefined;
  private loopbackTimer: NodeJS.Timeout | undefined;
  private searchHintTimer: NodeJS.Timeout | undefined;
  private restartTimer: NodeJS.Timeout | undefined;
  private retryAttempt = 0;
  private paired = false;
  private generation = 0;
  private statusService?: { set_status(message: string, isError: boolean): void };
  private zoneMap: ZoneMap = {};
  private snapshot: RoonServiceSnapshot = {
    status: 'idle',
    message: 'Waiting to search for a Roon Server',
    serverName: undefined,
    zones: []
  };

  constructor(
    private readonly store: SettingsStore,
    private readonly onChange: (snapshot: RoonServiceSnapshot) => void,
    private readonly log: (message: string) => void
  ) {}

  start(manual?: { host: string; port: number }): void {
    if (this.roon) return;
    const generation = ++this.generation;
    this.paired = false;
    this.retryAttempt = 0;

    const roon = new RoonApi({
      // The upstream logger prints complete registration payloads, including the
      // persisted authorization token. Route only our redacted diagnostics instead.
      log_level: 'none',
      extension_id: process.env.ROON_EXTENSION_ID ?? 'io.github.suvir0.roon-rich-presence',
      display_name: 'Roon Rich Presence',
      display_version: app.getVersion(),
      publisher: process.env.PROJECT_PUBLISHER ?? 'Suvir Potdar',
      email: process.env.PROJECT_SUPPORT_EMAIL ?? 'hello@suvir.net',
      website: process.env.PROJECT_CONTACT_URL ?? 'https://github.com/Suvir0/roon-rich-presence',
      force_server: true,
      get_persisted_state: () => this.store.getRoonState(),
      set_persisted_state: (state: Record<string, unknown>) => this.store.setRoonState(state),
      core_paired: (core: RoonCore) => {
        if (generation === this.generation) this.handlePaired(core, generation);
      },
      core_unpaired: () => {
        if (generation === this.generation) this.handleUnpaired(generation);
      },
      moo_onerror: () => {
        // node-roon-api passes the Moo object, not the WebSocket error. Real
        // transport errors are logged from patchWsConnect. Do not restart here —
        // a live "waiting for Enable" session must stay open.
      }
    });
    this.roon = roon;

    this.statusService = new RoonApiStatus(roon);
    roon.init_services({
      required_services: [RoonApiTransport],
      // Image is optional — artwork uses MusicBrainz, not Roon's image service.
      optional_services: [RoonApiImage],
      provided_services: [this.statusService]
    });
    this.statusService.set_status('Searching for Roon Server and Discord', false);

    // Wrap ws_connect at the instance level so every connection — whether from
    // probeLoopback, start_discovery, or openManualConnection — transitions the
    // status to 'waiting' the moment the WebSocket opens. The wrap is applied before
    // any connection attempt and is safe because open events fire asynchronously.
    this.patchWsConnect(roon, generation);

    if (manual) {
      // Manual mode: connect directly to the saved address only.
      // Do NOT also call start_discovery() — a parallel SOOD connection to the same
      // Roon Server creates a duplicate registration attempt which Roon rejects with
      // "ERROR undefined", causing a reconnect loop.
      this.log(`Manual mode: ${manual.host}:${manual.port}`);
      this.setSnapshot({
        status: 'searching',
        message: `Connecting to Roon at ${manual.host}:${manual.port}…`
      });
      void this.openManualConnection(roon, manual.host, manual.port, generation);
    } else {
      // Auto mode: probe loopback first (no TCC needed), then start SOOD after a
      // brief window. This prevents both paths from reaching the same Core
      // simultaneously (which causes a duplicate-register "ERROR undefined" loop).
      this.log('Auto mode: loopback probe then SOOD discovery');
      this.setSnapshot({
        status: 'searching',
        message: 'Searching your network for Roon Server…'
      });
      this.scheduleSearchHint(generation);
      this.probeLoopback(roon, generation);
      this.scheduleLoopbackTimeout(roon, generation);
    }
  }

  stop(): void {
    this.generation += 1;
    const roon = this.roon;
    this.roon = undefined;
    this.paired = false;
    this.clearRetryTimer();
    this.clearLoopbackTimer();
    this.clearSearchHint();
    this.clearRestartTimer();
    // Close the manual WebSocket before stopping discovery so Roon Core does not
    // accumulate orphan connections from the same extension_id across restarts.
    this.closeManualConn();
    roon?.stop_discovery?.();
    roon?.disconnect_all?.();
    this.zoneMap = {};
    this.setSnapshot({
      status: 'idle',
      message: 'Roon integration stopped',
      serverName: undefined,
      zones: []
    });
  }

  restart(manual?: { host: string; port: number }): void {
    this.log(
      manual
        ? `Restarting in manual mode: ${manual.host}:${manual.port}`
        : 'Restarting in auto mode'
    );
    this.stop();
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined;
      this.start(manual);
    }, RESTART_DELAY_MS);
    this.restartTimer.unref();
  }

  getSnapshot(): RoonServiceSnapshot {
    return { ...this.snapshot, zones: [...this.snapshot.zones] };
  }

  /**
   * Wrap roon.ws_connect so that when any WebSocket opens the status flips to
   * 'waiting'. The library has already assigned transport.onopen before returning
   * from ws_connect, so we compose our handler around it. Because WebSocket open
   * events are always asynchronous this never races with the library's handler.
   *
   * Also: node-roon-api only fires transport.onclose if the socket opened first
   * (`_isonopencalled`). A failed connect therefore leaves SOOD's `_sood_conns`
   * entry forever, and that Core is never retried. If the socket errors before
   * open, invoke the library onclose so discovery can try again.
   */
  private patchWsConnect(roon: RoonApiInstance, generation: number): void {
    const original = roon.ws_connect?.bind(roon);
    if (!original) return;
    roon.ws_connect = (options) => {
      const conn = original(options);
      const transport = conn?.transport;
      if (transport) {
        const origOnopen = transport.onopen;
        const origOnclose = transport.onclose;
        const origOnerror = transport.onerror;
        transport.onopen = () => {
          if (generation === this.generation && !this.paired) {
            this.clearSearchHint();
            this.setSnapshot({
              status: 'waiting',
              message: 'Enable this extension in Roon Settings → Extensions'
            });
          }
          origOnopen.call(transport);
        };
        transport.onerror = (err?: unknown) => {
          if (generation === this.generation && !this.paired) {
            this.log(`Roon transport error: ${describeError(err)}`);
          }
          origOnerror.call(transport, err);
          if (!transport._isonopencalled) {
            origOnclose.call(transport);
          }
        };
      }
      return conn;
    };
  }

  /**
   * Try connecting to 127.0.0.1 at well-known Roon ports. Loopback traffic is exempt
   * from macOS Local Network TCC, so this lets a Finder-launched app reach a same-Mac
   * Roon Server without the Local Network permission prompt.
   *
   * If the connection opens (→ 'waiting') but then closes without pairing, revert
   * to 'searching' and start SOOD immediately so a remote Core can still be found.
   */
  private probeLoopback(roon: RoonApiInstance, generation: number): void {
    if (!roon.ws_connect) return;
    for (const port of LOOPBACK_PORTS) {
      roon.ws_connect({
        host: '127.0.0.1',
        port,
        onclose: () => {
          if (generation !== this.generation || this.paired) return;
          if (this.snapshot.status === 'waiting') {
            // This loopback opened but Roon closed it before pairing.
            // Revert and start SOOD so a remote Core can still be found.
            this.setSnapshot({
              status: 'searching',
              message: 'Searching your network for Roon Server…'
            });
            this.startSood(roon, generation);
          }
        }
      });
    }
  }

  /**
   * After LOOPBACK_TIMEOUT_MS, if still unpaired and no connection is already open
   * (status !== 'waiting'), start SOOD discovery. This ensures the loopback probe
   * gets its window first so both never race to the same Core.
   */
  private scheduleLoopbackTimeout(roon: RoonApiInstance, generation: number): void {
    this.loopbackTimer = setTimeout(() => {
      this.loopbackTimer = undefined;
      if (generation !== this.generation || this.paired) return;
      if (this.snapshot.status === 'waiting' || this.snapshot.status === 'connected') return;
      this.startSood(roon, generation);
    }, LOOPBACK_TIMEOUT_MS);
    this.loopbackTimer.unref();
  }

  private startSood(roon: RoonApiInstance, generation: number): void {
    if (generation !== this.generation || this.paired) return;
    if (this.snapshot.status === 'waiting' || this.snapshot.status === 'connected') return;
    try {
      roon.start_discovery();
    } catch (error) {
      this.log(
        `SOOD discovery failed: ${error instanceof Error ? error.message : 'unknown error'}`
      );
      if (generation === this.generation) {
        this.setSnapshot({
          status: 'searching',
          message:
            'Automatic discovery could not start — try entering a manual server address in Settings.'
        });
      }
    }
  }

  /**
   * Open a direct WebSocket to a specific Roon Server host/port (manual mode only).
   * Retries on close with exponential backoff and never abandons the saved address.
   * Falling back to SOOD was causing a stuck unique_id (library skips onclose when
   * the socket never opened) and a 60s restart that killed live "waiting" sessions.
   */
  private async openManualConnection(
    roon: RoonApiInstance,
    host: string,
    port: number,
    generation: number
  ): Promise<void> {
    if (generation !== this.generation || this.paired || !this.roon) return;
    if (!roon.ws_connect) {
      this.log('ws_connect unavailable on this RoonApi instance');
      return;
    }
    // Warm the LAN path so macOS can show the Local Network prompt before the
    // Roon WebSocket races ahead and fails in 1ms under a pending/denied grant.
    await warmLanTcp(host, port);
    if (generation !== this.generation || this.paired || !this.roon) return;

    // Close any previous manual connection before opening a new one so Roon Core
    // does not see two concurrent registrations from the same extension_id.
    this.closeManualConn();
    this.log(`Attempting ${host}:${port} (attempt ${this.retryAttempt + 1})`);
    const conn = roon.ws_connect({
      host,
      port,
      onclose: () => {
        if (generation !== this.generation || this.paired) return;
        if (this.snapshot.status === 'waiting' || this.snapshot.status === 'connected') {
          this.setSnapshot({
            status: 'searching',
            message: `Roon at ${host}:${port} disconnected — retrying…`
          });
        } else {
          this.setSnapshot({
            status: 'searching',
            message: lanUnreachableMessage(host, port)
          });
        }
        this.scheduleManualRetry(roon, host, port, generation);
      }
    });
    if (conn?.transport) {
      this.manualConn = conn;
    }
  }

  private scheduleManualRetry(
    roon: RoonApiInstance,
    host: string,
    port: number,
    generation: number
  ): void {
    if (generation !== this.generation || this.paired || !this.roon || this.retryTimer) return;
    this.retryAttempt += 1;
    const delay = Math.min(15_000, 1_000 * 2 ** Math.min(this.retryAttempt - 1, 4));
    this.retryTimer = setTimeout(
      () => {
        this.retryTimer = undefined;
        if (generation !== this.generation || this.paired) return;
        void this.openManualConnection(roon, host, port, generation);
      },
      delay + Math.floor(Math.random() * 500)
    );
    this.retryTimer.unref();
  }

  private closeManualConn(): void {
    const conn = this.manualConn;
    this.manualConn = undefined;
    if (conn?.transport) {
      try {
        conn.transport.close();
      } catch {
        // ignore — connection may already be closed
      }
    }
  }

  private clearRetryTimer(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
    }
  }

  private clearLoopbackTimer(): void {
    if (this.loopbackTimer) {
      clearTimeout(this.loopbackTimer);
      this.loopbackTimer = undefined;
    }
  }

  private clearRestartTimer(): void {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = undefined;
    }
  }

  private scheduleSearchHint(generation: number): void {
    if (this.searchHintTimer) return; // already scheduled
    this.searchHintTimer = setTimeout(() => {
      this.searchHintTimer = undefined;
      if (generation !== this.generation || this.paired || this.snapshot.status !== 'searching') {
        return;
      }
      this.setSnapshot({ message: searchHintMessage() });
    }, SEARCH_HINT_MS);
    this.searchHintTimer.unref();
  }

  private clearSearchHint(): void {
    if (this.searchHintTimer) {
      clearTimeout(this.searchHintTimer);
      this.searchHintTimer = undefined;
    }
  }

  private handlePaired(core: RoonCore, generation: number): void {
    if (generation !== this.generation) return;
    this.paired = true;
    this.clearSearchHint();
    this.clearRetryTimer();
    this.clearLoopbackTimer();
    this.manualConn = undefined; // now managed by Roon library; don't close it on stop
    this.retryAttempt = 0;
    const serverName = core.display_name ?? 'Roon Server';
    this.log(`Paired with ${serverName}`);
    this.statusService?.set_status('Connected — publishing the selected zone to Discord', false);
    this.setSnapshot({ status: 'connected', message: 'Connected and authorized', serverName });
    const transport = core.services.RoonApiTransport;
    if (!transport) {
      this.setSnapshot({
        status: 'error',
        message: 'Roon Transport service is unavailable',
        serverName
      });
      return;
    }
    transport.subscribe_zones((response, body) => {
      if (response === 'Subscribed' && Array.isArray(body.zones)) {
        this.zoneMap = reduceZoneEvent(this.zoneMap, {
          type: 'full',
          zones: body.zones as RoonZone[]
        });
      } else if (response === 'Changed') {
        this.zoneMap = reduceZoneEvent(this.zoneMap, {
          type: 'delta',
          ...(Array.isArray(body.zones_added)
            ? { zonesAdded: body.zones_added as RoonZone[] }
            : {}),
          ...(Array.isArray(body.zones_changed)
            ? { zonesChanged: body.zones_changed as RoonZone[] }
            : {}),
          ...(Array.isArray(body.zones_removed)
            ? { zonesRemoved: body.zones_removed as string[] }
            : {}),
          ...(Array.isArray(body.zones_seek_changed)
            ? {
                zonesSeekChanged: body.zones_seek_changed as {
                  zone_id?: unknown;
                  seek_position?: unknown;
                }[]
              }
            : {})
        });
      } else if (response === 'Unsubscribed') {
        this.zoneMap = {};
      }
      this.setSnapshot({ zones: Object.values(this.zoneMap) });
    });
  }

  private handleUnpaired(generation: number): void {
    if (generation !== this.generation) return;
    this.paired = false;
    this.log('Roon Server authorization removed');
    this.zoneMap = {};
    this.statusService?.set_status(
      'Waiting for authorization in Roon Settings → Extensions',
      false
    );
    this.setSnapshot({
      status: 'waiting',
      message: 'Enable this extension in Roon Settings → Extensions',
      serverName: undefined,
      zones: []
    });
  }

  private setSnapshot(patch: Partial<RoonServiceSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.onChange(this.getSnapshot());
  }
}

function describeError(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err.trim()) return err;
  if (err && typeof err === 'object') {
    const record = err as { message?: unknown; error?: unknown; code?: unknown };
    if (typeof record.message === 'string' && record.message.trim()) return record.message;
    if (typeof record.error === 'string' && record.error.trim()) return record.error;
    if (typeof record.code === 'string' && record.code.trim()) return record.code;
  }
  return 'connection failed';
}

function searchHintMessage(): string {
  return process.platform === 'darwin'
    ? 'Still searching… Make sure VPN is off and this Mac is on the same Wi-Fi as the Roon Server. If the problem persists, open System Settings → Privacy & Security → Local Network, allow Roon Rich Presence, then quit and reopen the app.'
    : 'Still searching… Make sure VPN is off and the Roon Server is on the same network, or enter a manual server address in Settings.';
}

function lanUnreachableMessage(host: string, port: number): string {
  return process.platform === 'darwin'
    ? `Cannot reach ${host}:${port}. Check that VPN is off and this Mac is on the same Wi-Fi as the Roon Server. On macOS you may also need to allow Local Network access in System Settings → Privacy & Security.`
    : `Cannot reach ${host}:${port}. Check that VPN is off and this device is on the same network as the Roon Server.`;
}

function warmLanTcp(host: string, port: number): Promise<void> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port, timeout: 2_500 });
    const done = () => {
      socket.removeAllListeners();
      socket.destroy();
      resolve();
    };
    socket.once('connect', done);
    socket.once('error', done);
    socket.once('timeout', done);
  });
}

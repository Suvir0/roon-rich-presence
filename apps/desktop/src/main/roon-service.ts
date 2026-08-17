import { app } from 'electron';
import { createRequire } from 'node:module';
import { createConnection, isIPv4 } from 'node:net';
import { networkInterfaces } from 'node:os';
import { reduceZoneEvent, type PlaybackState, type RoonZone, type ZoneMap } from '@rrp/core';
import type { ConnectionStatus } from '../shared/contracts';
import { RoonDiscovery, type RoonDiscoveredEndpoint } from './roon-discovery';

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

const SEARCH_HINT_MS = 12_000;
const REGISTRATION_HINT_MS = 1_500;
const REGISTRATION_TIMEOUT_MS = 15_000;
const DIRECTED_DISCOVERY_TIMEOUT_MS = 2_500;
const PORT_PROBE_TIMEOUT_MS = 400;
const PORT_PROBE_CONCURRENCY = 4;
const RESTART_DELAY_MS = 400;
const MAX_ENDPOINTS = 16;

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
}
interface RoonApiInstance {
  init_services(options: {
    required_services: unknown[];
    optional_services?: unknown[];
    provided_services: unknown[];
  }): void;
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
interface RoonApiOptions extends Record<string, unknown> {
  core_paired(core: RoonCore): void;
  core_unpaired(core: RoonCore): void;
}
interface DiscoveryController {
  start(): void;
  stop(): void;
}
interface RoonServiceDependencies {
  createRoon(options: RoonApiOptions): RoonApiInstance;
  createStatusService(roon: RoonApiInstance): {
    services: unknown[];
    set_status(message: string, isError: boolean): void;
  };
  createDiscovery(options: ConstructorParameters<typeof RoonDiscovery>[0]): DiscoveryController;
  testEndpoint(
    host: string,
    port: number,
    timeoutMs?: number
  ): Promise<{ ok: true } | { ok: false; code?: string }>;
  probePorts(
    host: string,
    ports: readonly number[],
    concurrency: number,
    timeoutMs: number,
    shouldContinue: () => boolean,
    onOpen: (port: number) => void
  ): Promise<number[]>;
}
interface RoonStore {
  getRoonState(): Record<string, unknown>;
  setRoonState(state: Record<string, unknown>): void;
  getLastRoonEndpoint?(): { host: string; port: number } | undefined;
  setLastRoonEndpoint?(endpoint: { host: string; port: number }): void;
}

export type RoonConnectionReason =
  | 'local-network-blocked'
  | 'discovery-timeout'
  | 'endpoint-unreachable'
  | 'authorization-required'
  | 'reconnecting';
export interface RoonServiceSnapshot {
  status: ConnectionStatus;
  message: string;
  reason: RoonConnectionReason | undefined;
  serverName: string | undefined;
  zones: PlaybackState[];
}
interface CandidateEndpoint {
  host: string;
  port: number;
  uniqueId?: string;
  priority: number;
  source: 'directed' | 'automatic' | 'cached' | 'manual' | 'probe';
}
export interface ConnectionLifecycleState {
  paired: boolean;
  coreUnpaired: boolean;
  transportClosed: boolean;
  reconnectRequired: boolean;
}
export type ConnectionLifecycleEvent = 'paired' | 'core-unpaired' | 'transport-closed';

export function advanceConnectionLifecycle(
  state: ConnectionLifecycleState,
  event: ConnectionLifecycleEvent
): ConnectionLifecycleState {
  if (event === 'paired')
    return { paired: true, coreUnpaired: false, transportClosed: false, reconnectRequired: false };
  if (event === 'core-unpaired')
    return {
      ...state,
      paired: false,
      coreUnpaired: true,
      reconnectRequired: state.transportClosed
    };
  return { ...state, paired: false, transportClosed: true, reconnectRequired: true };
}

interface ActiveAttempt {
  endpoint: CandidateEndpoint;
  connection?: RoonConnection;
  registrationHint?: NodeJS.Timeout;
  registrationTimeout?: NodeJS.Timeout;
  settled: boolean;
  transportOpened: boolean;
  core?: RoonCore;
  lifecycle: ConnectionLifecycleState;
}

export type RoonConnectionStrategy =
  | { mode: 'automatic' }
  | { mode: 'directed'; host: string }
  | { mode: 'exact'; host: string; port: number };

export function connectionStrategy(manual?: {
  host: string;
  port?: number;
}): RoonConnectionStrategy {
  if (!manual) return { mode: 'automatic' };
  return manual.port
    ? { mode: 'exact', host: manual.host, port: manual.port }
    : { mode: 'directed', host: manual.host };
}

export class RoonService {
  private roon?: RoonApiInstance;
  private discovery?: DiscoveryController;
  private activeAttempt?: ActiveAttempt;
  private readonly endpointQueue = new Map<string, CandidateEndpoint>();
  private readonly retryAttempts = new Map<string, number>();
  private readonly retryTimers = new Map<string, NodeJS.Timeout>();
  private readonly disconnectedCores = new WeakSet<RoonCore>();
  private searchHintTimer?: NodeJS.Timeout;
  private manualProbeTimer?: NodeJS.Timeout;
  private restartTimer?: NodeJS.Timeout;
  private manualFallbackStopped = false;
  private discoveryPolicyFailures = 0;
  private paired = false;
  private generation = 0;
  private statusService?: { set_status(message: string, isError: boolean): void };
  private zoneMap: ZoneMap = {};
  private snapshot: RoonServiceSnapshot = {
    status: 'idle',
    message: 'Waiting to search for a Roon Server',
    reason: undefined,
    serverName: undefined,
    zones: []
  };
  private readonly dependencies: RoonServiceDependencies;

  constructor(
    private readonly store: RoonStore,
    private readonly onChange: (snapshot: RoonServiceSnapshot) => void,
    private readonly log: (message: string) => void,
    dependencies: Partial<RoonServiceDependencies> = {}
  ) {
    this.dependencies = {
      createRoon: (options) => new RoonApi(options),
      createStatusService: (roon) => new RoonApiStatus(roon),
      createDiscovery: (options) => new RoonDiscovery(options),
      testEndpoint: testTcpEndpoint,
      probePorts: probeOpenPorts,
      ...dependencies
    };
  }

  start(manual?: { host: string; port?: number }): void {
    if (this.roon) return;
    const generation = ++this.generation;
    this.paired = false;
    this.endpointQueue.clear();
    this.retryAttempts.clear();
    this.retryTimers.clear();
    this.manualFallbackStopped = false;
    this.discoveryPolicyFailures = 0;
    const roon = this.dependencies.createRoon({
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
      core_unpaired: (core: RoonCore) => {
        if (generation === this.generation) this.handleUnpaired(core, generation);
      },
      moo_onerror: () => undefined
    });
    this.roon = roon;
    this.statusService = this.dependencies.createStatusService(roon);
    roon.init_services({
      required_services: [RoonApiTransport],
      optional_services: [RoonApiImage],
      provided_services: [this.statusService]
    });
    this.statusService.set_status('Searching for Roon Server and Discord', false);
    const strategy = connectionStrategy(manual);
    this.setSnapshot({
      status: 'searching',
      message:
        strategy.mode === 'automatic'
          ? 'Searching your network for Roon Server…'
          : strategy.mode === 'directed'
            ? `Finding the Roon API endpoint at ${strategy.host}…`
            : `Connecting to the Roon API at ${strategy.host}:${strategy.port}…`,
      reason: undefined,
      serverName: undefined,
      zones: []
    });
    if (strategy.mode === 'exact') {
      this.log(`Exact manual endpoint: ${strategy.host}:${strategy.port}`);
      this.enqueueEndpoint(
        { host: strategy.host, port: strategy.port, source: 'manual', priority: 100 },
        generation
      );
      return;
    }
    this.log(
      strategy.mode === 'directed'
        ? `Directed discovery: ${strategy.host}`
        : 'Automatic SOOD discovery'
    );
    this.scheduleSearchHint(generation);
    const discovery = this.dependencies.createDiscovery({
      ...(strategy.mode === 'directed' ? { directedHost: strategy.host, directedOnly: true } : {}),
      onEndpoint: (endpoint) => {
        if (generation === this.generation) this.addDiscoveredEndpoint(endpoint, generation);
      },
      onError: (error) => {
        if (generation === this.generation) this.handleDiscoveryError(error);
      }
    });
    this.discovery = discovery;
    discovery.start();
    if (strategy.mode === 'automatic') {
      const cached = this.store.getLastRoonEndpoint?.();
      if (cached) this.enqueueEndpoint({ ...cached, source: 'cached', priority: 50 }, generation);
    } else {
      const cached = this.store.getLastRoonEndpoint?.();
      this.manualProbeTimer = setTimeout(() => {
        delete this.manualProbeTimer;
        void this.runManualFallback(strategy.host, cached, generation);
      }, DIRECTED_DISCOVERY_TIMEOUT_MS);
      this.manualProbeTimer.unref();
    }
  }

  stop(): void {
    this.generation += 1;
    const roon = this.roon;
    delete this.roon;
    this.paired = false;
    this.discovery?.stop();
    delete this.discovery;
    this.clearTimers();
    this.closeActiveAttempt();
    roon?.disconnect_all?.();
    this.endpointQueue.clear();
    this.retryAttempts.clear();
    this.retryTimers.clear();
    this.zoneMap = {};
    this.setSnapshot({
      status: 'idle',
      message: 'Roon integration stopped',
      reason: undefined,
      serverName: undefined,
      zones: []
    });
  }

  restart(manual?: { host: string; port?: number }): void {
    this.log(manual ? `Restarting directed discovery: ${manual.host}` : 'Restarting discovery');
    this.stop();
    this.restartTimer = setTimeout(() => {
      delete this.restartTimer;
      this.start(manual);
    }, RESTART_DELAY_MS);
    this.restartTimer.unref();
  }

  getSnapshot(): RoonServiceSnapshot {
    return { ...this.snapshot, zones: [...this.snapshot.zones] };
  }

  private addDiscoveredEndpoint(endpoint: RoonDiscoveredEndpoint, generation: number): void {
    this.clearSearchHint();
    this.discoveryPolicyFailures = 0;
    this.enqueueEndpoint(
      {
        host: endpoint.host,
        port: endpoint.port,
        uniqueId: endpoint.uniqueId,
        source: endpoint.source,
        priority: endpointPriority(endpoint)
      },
      generation
    );
  }

  private enqueueEndpoint(endpoint: CandidateEndpoint, generation: number): void {
    if (generation !== this.generation || this.paired || !this.roon) return;
    const key = endpointKey(endpoint);
    if (!shouldEnqueueEndpoint(this.activeAttempt?.endpoint, endpoint)) return;
    if (this.retryTimers.has(key)) return;
    const existing = this.endpointQueue.get(key);
    if (!existing || endpoint.priority > existing.priority) this.endpointQueue.set(key, endpoint);
    if (this.endpointQueue.size > MAX_ENDPOINTS) {
      const lowest = [...this.endpointQueue.entries()].sort(
        ([, left], [, right]) => left.priority - right.priority
      )[0];
      if (lowest) this.endpointQueue.delete(lowest[0]);
    }
    this.processQueue(generation);
  }

  private processQueue(generation: number): void {
    if (generation !== this.generation || this.paired || this.activeAttempt || !this.roon) return;
    const next = [...this.endpointQueue.values()].sort(
      (left, right) => right.priority - left.priority
    )[0];
    if (!next) return;
    this.endpointQueue.delete(endpointKey(next));
    void this.connectEndpoint(next, generation);
  }

  private async connectEndpoint(endpoint: CandidateEndpoint, generation: number): Promise<void> {
    const attempt: ActiveAttempt = {
      endpoint,
      settled: false,
      transportOpened: false,
      lifecycle: {
        paired: false,
        coreUnpaired: false,
        transportClosed: false,
        reconnectRequired: false
      }
    };
    this.activeAttempt = attempt;
    this.setSnapshot({
      status: 'searching',
      message: `Connecting to the Roon API at ${endpoint.host}:${endpoint.port}…`,
      reason: this.retryAttempts.has(endpointKey(endpoint)) ? 'reconnecting' : undefined
    });
    this.log(`Trying Roon endpoint ${endpoint.host}:${endpoint.port} (${endpoint.source})`);
    const reachability = await this.dependencies.testEndpoint(endpoint.host, endpoint.port);
    if (generation !== this.generation || this.activeAttempt !== attempt) return;
    if (!reachability.ok) {
      const priorFailures = this.retryAttempts.get(endpointKey(endpoint)) ?? 0;
      const blocked =
        classifyEndpointFailure(reachability.code, endpoint.host, priorFailures) ===
        'local-network-blocked';
      this.setSnapshot({
        status: 'searching',
        message: blocked
          ? 'macOS is blocking local network access. Allow Roon Rich Presence in System Settings → Privacy & Security → Local Network.'
          : `Roon API endpoint ${endpoint.host}:${endpoint.port} is not reachable. Retrying…`,
        reason: blocked ? 'local-network-blocked' : 'endpoint-unreachable'
      });
      this.log(`Roon endpoint failed: ${reachability.code ?? 'unreachable'}`);
      this.failAttempt(attempt, generation, true);
      return;
    }
    const roon = this.roon;
    if (!roon?.ws_connect) {
      this.setSnapshot({ status: 'error', message: 'Roon WebSocket transport is unavailable' });
      this.failAttempt(attempt, generation, false);
      return;
    }
    try {
      const connection = roon.ws_connect({
        host: endpoint.host,
        port: endpoint.port,
        onerror: () => this.failAttempt(attempt, generation, true),
        onclose: () => this.handleTransportClosed(attempt, generation)
      });
      attempt.connection = connection;
      const transport = connection.transport;
      if (transport) {
        const originalOnopen = transport.onopen;
        transport.onopen = () => {
          originalOnopen.call(transport);
          attempt.transportOpened = true;
          this.manualFallbackStopped = true;
          if (this.manualProbeTimer) clearTimeout(this.manualProbeTimer);
          delete this.manualProbeTimer;
          if (generation !== this.generation || this.paired || this.activeAttempt !== attempt)
            return;
          // The public node-roon-api surface reports WebSocket open and core_paired,
          // but has no callback for "registration is awaiting authorization". Keep
          // the session alive and describe only the stage we can actually observe.
          attempt.registrationHint = setTimeout(() => {
            delete attempt.registrationHint;
            if (generation !== this.generation || this.paired || this.activeAttempt !== attempt)
              return;
            this.setSnapshot({
              status: 'waiting',
              message: 'Connected to Roon API; waiting for registration to complete…',
              reason: undefined
            });
          }, REGISTRATION_HINT_MS);
          attempt.registrationHint.unref();
        };
      }
      attempt.registrationTimeout = setTimeout(() => {
        delete attempt.registrationTimeout;
        if (
          generation !== this.generation ||
          this.paired ||
          this.activeAttempt !== attempt ||
          attempt.transportOpened
        )
          return;
        this.failAttempt(attempt, generation, true);
      }, REGISTRATION_TIMEOUT_MS);
      attempt.registrationTimeout.unref();
    } catch (error) {
      this.log(`Roon WebSocket failed: ${describeError(error)}`);
      this.failAttempt(attempt, generation, true);
    }
  }

  private failAttempt(attempt: ActiveAttempt, generation: number, retry: boolean): void {
    if (attempt.settled || generation !== this.generation || this.activeAttempt !== attempt) return;
    attempt.settled = true;
    clearAttemptTimers(attempt);
    delete this.activeAttempt;
    try {
      attempt.connection?.transport?.close();
    } catch {
      /* already closed */
    }
    if (retry) this.scheduleEndpointRetry(attempt.endpoint, generation);
    this.processQueue(generation);
  }

  private scheduleEndpointRetry(endpoint: CandidateEndpoint, generation: number): void {
    if (generation !== this.generation || this.paired || !this.roon) return;
    const key = endpointKey(endpoint);
    const count = (this.retryAttempts.get(key) ?? 0) + 1;
    this.retryAttempts.set(key, count);
    const delay = Math.min(15_000, 1_000 * 2 ** Math.min(count - 1, 4));
    if (this.retryTimers.has(key)) return;
    const timer = setTimeout(
      () => {
        this.retryTimers.delete(key);
        this.enqueueEndpoint(endpoint, generation);
      },
      delay + Math.floor(Math.random() * 350)
    );
    timer.unref();
    this.retryTimers.set(key, timer);
  }

  private handlePaired(core: RoonCore, generation: number): void {
    if (generation !== this.generation) return;
    this.disconnectedCores.delete(core);
    this.paired = true;
    this.manualFallbackStopped = true;
    if (this.manualProbeTimer) clearTimeout(this.manualProbeTimer);
    delete this.manualProbeTimer;
    this.clearSearchHint();
    for (const timer of this.retryTimers.values()) clearTimeout(timer);
    this.retryTimers.clear();
    const attempt = this.activeAttempt;
    if (attempt) {
      attempt.settled = true;
      attempt.core = core;
      attempt.lifecycle = advanceConnectionLifecycle(attempt.lifecycle, 'paired');
      clearAttemptTimers(attempt);
      this.store.setLastRoonEndpoint?.({
        host: attempt.endpoint.host,
        port: attempt.endpoint.port
      });
    }
    this.retryAttempts.clear();
    const serverName = core.display_name ?? 'Roon Server';
    this.log(`Paired with ${serverName}`);
    this.statusService?.set_status('Connected — publishing the selected zone to Discord', false);
    this.setSnapshot({
      status: 'connected',
      message: 'Connected and authorized',
      reason: undefined,
      serverName
    });
    const transport = core.services.RoonApiTransport;
    if (!transport) {
      this.setSnapshot({ status: 'error', message: 'Roon Transport service is unavailable' });
      return;
    }
    transport.subscribe_zones((response, body) => {
      if (response === 'Subscribed' && Array.isArray(body.zones))
        this.zoneMap = reduceZoneEvent(this.zoneMap, {
          type: 'full',
          zones: body.zones as RoonZone[]
        });
      else if (response === 'Changed')
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
      else if (response === 'Unsubscribed') this.zoneMap = {};
      this.setSnapshot({ zones: Object.values(this.zoneMap) });
    });
  }

  private handleUnpaired(core: RoonCore, generation: number): void {
    if (generation !== this.generation || !this.roon) return;
    if (this.disconnectedCores.has(core)) {
      this.disconnectedCores.delete(core);
      return;
    }
    const attempt = this.activeAttempt;
    if (attempt?.core && attempt.core !== core) return;
    this.paired = false;
    this.zoneMap = {};
    if (attempt) attempt.lifecycle = advanceConnectionLifecycle(attempt.lifecycle, 'core-unpaired');
    this.log('Roon Server authorization removed');
    this.statusService?.set_status(
      'Waiting for authorization in Roon Settings → Extensions',
      false
    );
    this.setSnapshot({
      status: 'waiting',
      message: 'Enable this extension in Roon Settings → Extensions',
      reason: 'authorization-required',
      serverName: undefined,
      zones: []
    });
  }

  private handleTransportClosed(attempt: ActiveAttempt, generation: number): void {
    attempt.lifecycle = advanceConnectionLifecycle(attempt.lifecycle, 'transport-closed');
    if (attempt.core) this.disconnectedCores.add(attempt.core);
    if (generation !== this.generation || this.activeAttempt !== attempt || !this.roon) return;
    attempt.settled = true;
    clearAttemptTimers(attempt);
    delete this.activeAttempt;
    this.paired = false;
    this.zoneMap = {};
    this.log('Roon connection lost; reconnecting');
    this.setSnapshot({
      status: 'searching',
      message: 'Roon Server disconnected — reconnecting…',
      reason: 'reconnecting',
      serverName: undefined,
      zones: []
    });
    this.scheduleEndpointRetry(attempt.endpoint, generation);
    this.processQueue(generation);
  }

  private handleDiscoveryError(error: Error): void {
    this.log(`Roon discovery error: ${error.message}`);
    const code = (error as NodeJS.ErrnoException).code;
    if (!isDiscoveryPolicyError(code, process.platform)) return;
    this.discoveryPolicyFailures += 1;
    if (this.discoveryPolicyFailures < 2 || this.paired) return;
    this.setSnapshot({
      status: 'searching',
      message:
        'macOS is blocking local network discovery. Allow Roon Rich Presence in System Settings → Privacy & Security → Local Network.',
      reason: 'local-network-blocked'
    });
  }

  private async runManualFallback(
    host: string,
    cached: { host: string; port: number } | undefined,
    generation: number
  ): Promise<void> {
    if (generation !== this.generation || this.paired || this.manualFallbackStopped) return;
    this.log(`Directed discovery timed out; probing bounded Roon API candidates at ${host}`);
    const ports = manualFallbackPorts(host, cached);
    const openPorts = await this.dependencies.probePorts(
      host,
      ports,
      PORT_PROBE_CONCURRENCY,
      PORT_PROBE_TIMEOUT_MS,
      () => generation === this.generation && !this.paired && !this.manualFallbackStopped,
      (port) => {
        if (generation === this.generation && !this.paired && !this.manualFallbackStopped)
          this.enqueueEndpoint({ host, port, source: 'probe', priority: 70 }, generation);
      }
    );
    if (generation !== this.generation || this.paired || this.manualFallbackStopped) return;
    // A non-empty result already triggered enqueueEndpoint via the onOpen callback above.
    if (openPorts.length === 0) {
      this.setSnapshot({
        status: 'searching',
        message: `No Roon API endpoint was reachable at ${host}. Check Local Network access and the server address.`,
        reason: 'endpoint-unreachable'
      });
    }
  }

  private scheduleSearchHint(generation: number): void {
    this.searchHintTimer = setTimeout(() => {
      delete this.searchHintTimer;
      if (
        generation !== this.generation ||
        this.paired ||
        this.activeAttempt ||
        this.snapshot.reason === 'local-network-blocked'
      )
        return;
      this.setSnapshot({
        message:
          'No Roon Server advertisement was found. Check Local Network access, VPN, Wi-Fi, and firewall settings.',
        reason: 'discovery-timeout'
      });
    }, SEARCH_HINT_MS);
    this.searchHintTimer.unref();
  }
  private clearSearchHint(): void {
    if (this.searchHintTimer) clearTimeout(this.searchHintTimer);
    delete this.searchHintTimer;
  }
  private clearTimers(): void {
    for (const timer of [this.searchHintTimer, this.manualProbeTimer, this.restartTimer])
      if (timer) clearTimeout(timer);
    for (const timer of this.retryTimers.values()) clearTimeout(timer);
    this.retryTimers.clear();
    delete this.searchHintTimer;
    delete this.manualProbeTimer;
    delete this.restartTimer;
  }
  private closeActiveAttempt(): void {
    const attempt = this.activeAttempt;
    delete this.activeAttempt;
    if (!attempt) return;
    attempt.settled = true;
    clearAttemptTimers(attempt);
    try {
      attempt.connection?.transport?.close();
    } catch {
      /* already closed */
    }
  }
  private setSnapshot(patch: Partial<RoonServiceSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.onChange(this.getSnapshot());
  }
}

function endpointKey(endpoint: { host: string; port: number }): string {
  return `${endpoint.host.toLowerCase()}:${endpoint.port}`;
}

export function shouldEnqueueEndpoint(
  active: { host: string; port: number } | undefined,
  candidate: { host: string; port: number }
): boolean {
  return !active || endpointKey(active) !== endpointKey(candidate);
}

export function manualFallbackPorts(
  host: string,
  cached: { host: string; port: number } | undefined
): number[] {
  const ports: number[] = [];
  if (cached?.host.toLowerCase() === host.toLowerCase()) ports.push(cached.port);
  for (let port = 9330; port <= 9339; port += 1) ports.push(port);
  for (let port = 9100; port <= 9200; port += 1) ports.push(port);
  return [...new Set(ports)];
}

export async function probeOpenPorts(
  host: string,
  ports: readonly number[],
  concurrency: number,
  timeoutMs: number,
  shouldContinue: () => boolean = () => true,
  onOpen: (port: number) => void = () => undefined,
  test: (
    host: string,
    port: number,
    timeoutMs: number
  ) => Promise<{ ok: true } | { ok: false; code?: string }> = testTcpEndpoint
): Promise<number[]> {
  const open = new Set<number>();
  let nextIndex = 0;
  const worker = async () => {
    while (shouldContinue()) {
      const index = nextIndex;
      nextIndex += 1;
      const port = ports[index];
      if (port === undefined) return;
      const result = await test(host, port, timeoutMs);
      if (result.ok) {
        open.add(port);
        onOpen(port);
      }
    }
  };
  const workerCount = Math.max(1, Math.min(Math.floor(concurrency), ports.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return ports.filter((port) => open.has(port));
}

export function endpointPriority(
  endpoint: Pick<RoonDiscoveredEndpoint, 'host' | 'source'>,
  interfaces = networkInterfaces()
): number {
  if (endpoint.source === 'directed') return 100;
  return isSameSubnetAddress(endpoint.host, interfaces) ? 90 : 80;
}

export function classifyEndpointFailure(
  code: string | undefined,
  host: string,
  priorFailures: number,
  platform = process.platform,
  interfaces = networkInterfaces()
): 'local-network-blocked' | 'endpoint-unreachable' {
  const routeFailure = code === 'EHOSTUNREACH' || code === 'ENETUNREACH' || code === 'ENETDOWN';
  return platform === 'darwin' &&
    routeFailure &&
    priorFailures >= 1 &&
    isSameSubnetAddress(host, interfaces)
    ? 'local-network-blocked'
    : 'endpoint-unreachable';
}

export function isDiscoveryPolicyError(code: string | undefined, platform: string): boolean {
  return (
    platform === 'darwin' &&
    (code === 'EACCES' ||
      code === 'EPERM' ||
      code === 'EHOSTUNREACH' ||
      code === 'ENETUNREACH' ||
      code === 'ENETDOWN')
  );
}

export function isSameSubnetAddress(host: string, interfaces = networkInterfaces()): boolean {
  if (!isIPv4(host)) return false;
  const target = ipv4Number(host);
  return Object.values(interfaces).some((entries) =>
    (entries ?? []).some((entry) => {
      if (
        entry.family !== 'IPv4' ||
        entry.internal ||
        !isIPv4(entry.address) ||
        !isIPv4(entry.netmask)
      )
        return false;
      const mask = ipv4Number(entry.netmask);
      return (target & mask) === (ipv4Number(entry.address) & mask);
    })
  );
}

function ipv4Number(address: string): number {
  return address.split('.').reduce((value, part) => (value << 8) | Number(part), 0) >>> 0;
}
function clearAttemptTimers(attempt: ActiveAttempt): void {
  if (attempt.registrationHint) clearTimeout(attempt.registrationHint);
  if (attempt.registrationTimeout) clearTimeout(attempt.registrationTimeout);
  delete attempt.registrationHint;
  delete attempt.registrationTimeout;
}
function testTcpEndpoint(
  host: string,
  port: number,
  timeoutMs = 2_500
): Promise<{ ok: true } | { ok: false; code?: string }> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port, timeout: timeoutMs });
    let settled = false;
    const done = (result: { ok: true } | { ok: false; code?: string }) => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };
    socket.once('connect', () => done({ ok: true }));
    socket.once('error', (error: NodeJS.ErrnoException) =>
      done({ ok: false, ...(error.code ? { code: error.code } : {}) })
    );
    socket.once('timeout', () => done({ ok: false, code: 'ETIMEDOUT' }));
  });
}
function describeError(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : typeof error === 'string' && error
      ? error
      : 'connection failed';
}

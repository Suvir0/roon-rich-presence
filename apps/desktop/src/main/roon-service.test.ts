import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getVersion: () => 'test' } }));

import {
  RoonService,
  advanceConnectionLifecycle,
  classifyEndpointFailure,
  connectionStrategy,
  endpointPriority,
  isDiscoveryPolicyError,
  isSameSubnetAddress,
  manualFallbackPorts,
  probeOpenPorts,
  shouldEnqueueEndpoint
} from './roon-service';
import type { RoonDiscoveredEndpoint } from './roon-discovery';

const interfaces = {
  en0: [
    {
      address: '192.168.50.248',
      netmask: '255.255.255.0',
      family: 'IPv4' as const,
      mac: '00:00:00:00:00:00',
      internal: false,
      cidr: '192.168.50.248/24'
    }
  ]
};

describe('Roon connection policy', () => {
  it('keeps an explicit manual port exact and makes host-only input directed', () => {
    expect(connectionStrategy({ host: 'roon.local', port: 9331 })).toEqual({
      mode: 'exact',
      host: 'roon.local',
      port: 9331
    });
    expect(connectionStrategy({ host: 'roon.local' })).toEqual({
      mode: 'directed',
      host: 'roon.local'
    });
    expect(connectionStrategy()).toEqual({ mode: 'automatic' });
  });

  it('prioritizes directed, then same-subnet, then other automatic endpoints', () => {
    expect(endpointPriority({ host: '203.0.113.2', source: 'directed' }, interfaces)).toBe(100);
    expect(endpointPriority({ host: '192.168.50.2', source: 'automatic' }, interfaces)).toBe(90);
    expect(endpointPriority({ host: '10.0.0.2', source: 'automatic' }, interfaces)).toBe(80);
    expect(isSameSubnetAddress('192.168.50.2', interfaces)).toBe(true);
  });

  it('does not let repeated advertisements bypass an active endpoint backoff', () => {
    expect(
      shouldEnqueueEndpoint(
        { host: '192.168.50.2', port: 9330 },
        { host: '192.168.50.2', port: 9330 }
      )
    ).toBe(false);
    expect(
      shouldEnqueueEndpoint(
        { host: '192.168.50.2', port: 9330 },
        { host: '192.168.50.2', port: 9331 }
      )
    ).toBe(true);
  });

  it('only reports macOS local-network blocking after repeated same-subnet route failures', () => {
    expect(classifyEndpointFailure('EHOSTUNREACH', '192.168.50.2', 0, 'darwin')).toBe(
      'endpoint-unreachable'
    );
    expect(classifyEndpointFailure('EHOSTUNREACH', '192.168.50.2', 1, 'darwin', interfaces)).toBe(
      'local-network-blocked'
    );
    expect(classifyEndpointFailure('EHOSTUNREACH', '203.0.113.2', 2, 'darwin', interfaces)).toBe(
      'endpoint-unreachable'
    );
    expect(classifyEndpointFailure('EHOSTUNREACH', '192.168.50.2', 2, 'linux', interfaces)).toBe(
      'endpoint-unreachable'
    );
  });

  it('reconnects on transport close regardless of core-unpaired callback order', () => {
    const initial = {
      paired: false,
      coreUnpaired: false,
      transportClosed: false,
      reconnectRequired: false
    };
    const paired = advanceConnectionLifecycle(initial, 'paired');
    const unpairedFirst = advanceConnectionLifecycle(paired, 'core-unpaired');
    expect(unpairedFirst.reconnectRequired).toBe(false);
    expect(advanceConnectionLifecycle(unpairedFirst, 'transport-closed').reconnectRequired).toBe(
      true
    );

    const closeFirst = advanceConnectionLifecycle(paired, 'transport-closed');
    expect(closeFirst.reconnectRequired).toBe(true);
    expect(advanceConnectionLifecycle(closeFirst, 'core-unpaired').reconnectRequired).toBe(true);
  });

  it('uses bounded manual fallback candidates with the matching cached port first', () => {
    const ports = manualFallbackPorts('192.168.50.2', {
      host: '192.168.50.2',
      port: 9342
    });
    expect(ports.slice(0, 4)).toEqual([9342, 9330, 9331, 9332]);
    expect(ports).toContain(9100);
    expect(ports).toContain(9200);
    expect(new Set(ports).size).toBe(ports.length);
    expect(manualFallbackPorts('other.local', { host: 'roon.local', port: 9342 })).not.toContain(
      9342
    );
  });

  it('probes with bounded concurrency and preserves candidate order', async () => {
    let active = 0;
    let maximumActive = 0;
    const opened: number[] = [];
    const result = await probeOpenPorts(
      'roon.local',
      [9330, 9331, 9332, 9333],
      2,
      10,
      () => true,
      (port) => opened.push(port),
      async (_host, port) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await Promise.resolve();
        active -= 1;
        return port === 9331 || port === 9333 ? { ok: true } : { ok: false as const };
      }
    );
    expect(maximumActive).toBeLessThanOrEqual(2);
    expect(result).toEqual([9331, 9333]);
    expect(opened.sort()).toEqual([9331, 9333]);
  });

  it('recognizes repeated macOS discovery policy failures without cross-platform false positives', () => {
    expect(isDiscoveryPolicyError('EACCES', 'darwin')).toBe(true);
    expect(isDiscoveryPolicyError('EHOSTUNREACH', 'darwin')).toBe(true);
    expect(isDiscoveryPolicyError('EACCES', 'linux')).toBe(false);
    expect(isDiscoveryPolicyError('ECONNREFUSED', 'darwin')).toBe(false);
  });
});

interface FakeConnectionOptions {
  host: string;
  port: number;
  onerror?: () => void;
  onclose?: () => void;
}

interface FakeCore {
  display_name?: string;
  services: {
    RoonApiTransport: { subscribe_zones: ReturnType<typeof vi.fn> };
  };
}

interface FakeRoonOptions extends Record<string, unknown> {
  core_paired(core: FakeCore): void;
  core_unpaired(core: FakeCore): void;
}

interface FakeDiscoveryOptions {
  directedHost?: string;
  directedOnly?: boolean;
  onEndpoint(endpoint: RoonDiscoveredEndpoint): void;
  onError?(error: Error): void;
}

function createServiceHarness(options?: {
  cached?: { host: string; port: number };
  probePorts?: (onOpen: (port: number) => void) => Promise<number[]>;
}) {
  const apiOptions: FakeRoonOptions[] = [];
  const roons: {
    requests: {
      options: FakeConnectionOptions;
      transport: { close: ReturnType<typeof vi.fn>; onopen: () => void };
    }[];
    init_services: ReturnType<typeof vi.fn>;
    disconnect_all: ReturnType<typeof vi.fn>;
    ws_connect(options: FakeConnectionOptions): {
      transport: { close: ReturnType<typeof vi.fn>; onopen: () => void };
    };
  }[] = [];
  const discoveries: {
    options: FakeDiscoveryOptions;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  }[] = [];
  const getLastRoonEndpoint = vi.fn(() => options?.cached);
  const setLastRoonEndpoint = vi.fn();
  const store = {
    getRoonState: vi.fn(() => ({})),
    setRoonState: vi.fn(),
    getLastRoonEndpoint,
    setLastRoonEndpoint
  };
  const snapshots: ReturnType<RoonService['getSnapshot']>[] = [];
  const service = new RoonService(store, (snapshot) => snapshots.push(snapshot), vi.fn(), {
    createRoon: (roonOptions) => {
      apiOptions.push(roonOptions as FakeRoonOptions);
      const requests: (typeof roons)[number]['requests'] = [];
      const roon = {
        requests,
        init_services: vi.fn(),
        disconnect_all: vi.fn(),
        ws_connect(connectionOptions: FakeConnectionOptions) {
          const transport = { close: vi.fn(), onopen: vi.fn() };
          requests.push({ options: connectionOptions, transport });
          return { transport };
        }
      };
      roons.push(roon);
      return roon;
    },
    createStatusService: () => ({ services: [], set_status: vi.fn() }),
    createDiscovery: (discoveryOptions) => {
      const discovery = {
        options: discoveryOptions as FakeDiscoveryOptions,
        start: vi.fn(),
        stop: vi.fn()
      };
      discoveries.push(discovery);
      return discovery;
    },
    testEndpoint: async () => ({ ok: true }),
    probePorts: async (_host, _ports, _concurrency, _timeout, _continue, onOpen) =>
      options?.probePorts ? options.probePorts(onOpen) : []
  });
  return {
    service,
    apiOptions,
    roons,
    discoveries,
    getLastRoonEndpoint,
    setLastRoonEndpoint,
    snapshots
  };
}

async function settleAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('RoonService connection integration', () => {
  it('uses only an explicit endpoint without discovery or cached endpoint access', async () => {
    vi.useFakeTimers();
    const harness = createServiceHarness({ cached: { host: 'cached.local', port: 9999 } });

    harness.service.start({ host: 'roon.local', port: 9444 });
    await settleAsyncWork();

    expect(harness.discoveries).toHaveLength(0);
    expect(harness.getLastRoonEndpoint).not.toHaveBeenCalled();
    expect(harness.roons[0]?.requests.map(({ options }) => [options.host, options.port])).toEqual([
      ['roon.local', 9444]
    ]);

    const request = harness.roons[0]?.requests[0];
    request?.transport.onopen();
    await vi.advanceTimersByTimeAsync(1_500);
    expect(harness.service.getSnapshot()).toMatchObject({
      status: 'waiting',
      message: 'Connected to Roon API; waiting for registration to complete…',
      reason: undefined
    });
    expect(harness.service.getSnapshot().message).not.toContain('Enable');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(harness.roons[0]?.requests).toHaveLength(1);
    harness.service.stop();
    vi.useRealTimers();
  });

  it('retries an exact endpoint after a pre-open connection error', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const harness = createServiceHarness();
    harness.service.start({ host: 'roon.local', port: 9330 });
    await settleAsyncWork();

    harness.roons[0]?.requests[0]?.options.onerror?.();
    await vi.advanceTimersByTimeAsync(1_000);
    await settleAsyncWork();

    expect(harness.roons[0]?.requests).toHaveLength(2);
    expect(harness.roons[0]?.requests[1]?.options).toMatchObject({
      host: 'roon.local',
      port: 9330
    });
    harness.service.stop();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('reconnects after unpair then close and ignores callbacks from a prior generation', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const harness = createServiceHarness();
    harness.service.start({ host: 'old.local', port: 9330 });
    await settleAsyncWork();
    const oldOptions = harness.apiOptions[0];
    const oldRequest = harness.roons[0]?.requests[0];
    const core: FakeCore = {
      display_name: 'Test Core',
      services: { RoonApiTransport: { subscribe_zones: vi.fn() } }
    };

    oldOptions?.core_paired(core);
    oldOptions?.core_unpaired(core);
    oldRequest?.options.onclose?.();
    expect(harness.service.getSnapshot()).toMatchObject({
      status: 'searching',
      reason: 'reconnecting'
    });
    await vi.advanceTimersByTimeAsync(1_000);
    await settleAsyncWork();
    expect(harness.roons[0]?.requests).toHaveLength(2);

    harness.service.restart({ host: 'new.local', port: 9444 });
    await vi.advanceTimersByTimeAsync(400);
    await settleAsyncWork();
    expect(harness.roons).toHaveLength(2);
    expect(harness.roons[1]?.requests[0]?.options).toMatchObject({ host: 'new.local', port: 9444 });

    oldOptions?.core_paired(core);
    oldOptions?.core_unpaired(core);
    oldRequest?.options.onclose?.();
    expect(harness.service.getSnapshot().message).toContain('new.local:9444');
    expect(harness.service.getSnapshot().serverName).toBeUndefined();
    harness.service.stop();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('connects to a dynamic directed discovery port in host-only mode', async () => {
    vi.useFakeTimers();
    const harness = createServiceHarness();
    harness.service.start({ host: 'roon.local' });
    const discovery = harness.discoveries[0];
    expect(discovery?.options).toMatchObject({ directedHost: 'roon.local', directedOnly: true });

    discovery?.options.onEndpoint({
      uniqueId: 'core-1',
      host: '192.168.50.2',
      port: 9477,
      source: 'directed'
    });
    await settleAsyncWork();
    expect(harness.roons[0]?.requests[0]?.options).toMatchObject({
      host: '192.168.50.2',
      port: 9477
    });
    harness.service.stop();
    vi.useRealTimers();
  });

  it('connects host-only mode to a TCP-open dynamic fallback port', async () => {
    vi.useFakeTimers();
    const harness = createServiceHarness({
      probePorts: async (onOpen) => {
        onOpen(9488);
        return [9488];
      }
    });
    harness.service.start({ host: '192.168.50.2' });
    await vi.advanceTimersByTimeAsync(2_500);
    await settleAsyncWork();

    expect(harness.roons[0]?.requests[0]?.options).toMatchObject({
      host: '192.168.50.2',
      port: 9488
    });
    harness.service.stop();
    vi.useRealTimers();
  });
});

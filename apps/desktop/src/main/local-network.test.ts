import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  connect: vi.fn(),
  once: vi.fn()
}));

vi.mock('node:dgram', () => ({
  createSocket: vi.fn(() => mocks)
}));

import { beginVisibleNetworkAccess, requestLocalNetworkAccess } from './local-network';

describe('requestLocalNetworkAccess', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.close.mockClear();
    mocks.connect.mockClear();
    mocks.once.mockClear();
  });

  it('connects a UDP socket to the SOOD multicast address without sending data', async () => {
    const request = requestLocalNetworkAccess('darwin');

    expect(mocks.connect).toHaveBeenCalledOnce();
    expect(mocks.connect).toHaveBeenCalledWith(9, '239.255.90.90');
    expect(mocks.close).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(3_000);
    await request;
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it('does nothing outside macOS', async () => {
    await requestLocalNetworkAccess('linux');
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it('begins the visible permission operation before starting Roon connectivity', async () => {
    const order: string[] = [];

    await beginVisibleNetworkAccess(
      async () => {
        order.push('permission');
      },
      () => order.push('roon')
    );

    expect(order).toEqual(['permission', 'roon']);
  });
});

// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSnapshot } from '../shared/contracts';
import App from './App';

const snapshot = (onboardingComplete: boolean) => ({
  version: '0.1.0',
  settings: {
    schemaVersion: 2 as const,
    presenceEnabled: true,
    zoneMode: 'selected' as const,
    selectedZoneId: 'living-room',
    showAlbum: true,
    showProgress: true,
    showZone: true,
    showWhenPaused: false,
    artworkLookupEnabled: false,
    startAtLogin: false,
    launchHidden: false,
    automaticUpdates: true,
    onboardingComplete
  },
  zones: [{ id: 'living-room', name: 'Living room', state: 'playing' as const }],
  playback: {
    zoneId: 'living-room',
    zoneName: 'Living room',
    state: 'playing' as const,
    track: 'Midnight City',
    artist: 'M83',
    album: 'Hurry Up, We’re Dreaming',
    positionSeconds: 42,
    durationSeconds: 244,
    artworkUrl: 'https://coverartarchive.org/release-group/example/front-500'
  },
  presence: {
    details: 'Midnight City',
    state: 'M83 — Hurry Up, We’re Dreaming',
    largeImage: 'https://coverartarchive.org/release-group/example/front-500',
    smallText: 'Living room',
    startTimestamp: 1_700_000_000,
    endTimestamp: 1_700_000_244,
    paused: false
  },
  roon: { status: 'connected' as const, message: 'Connected', serverName: 'Roon Server' },
  discord: { status: 'connected' as const, message: 'Connected' },
  artwork: { status: 'connected' as const, message: 'Matched' }
});

function installApi(onboardingComplete: boolean) {
  const updateSettings = vi.fn().mockResolvedValue(snapshot(onboardingComplete));
  const completeOnboarding = vi.fn().mockResolvedValue(snapshot(true));
  const forgetRoon = vi.fn().mockResolvedValue(snapshot(onboardingComplete));
  window.rrp = {
    getSnapshot: vi.fn().mockResolvedValue(snapshot(onboardingComplete)),
    updateSettings,
    completeOnboarding,
    forgetRoon,
    copyDiagnostics: vi.fn().mockResolvedValue(true),
    openLocalNetworkSettings: vi.fn().mockResolvedValue(true),
    openExternal: vi.fn().mockResolvedValue(true),
    subscribe: vi.fn().mockReturnValue(() => undefined)
  };
  return { updateSettings, completeOnboarding, forgetRoon };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

let container: HTMLDivElement;
let root: Root;

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = false;
});

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  delete window.rrp;
});

async function renderApp() {
  await act(async () => root.render(<App />));
  await act(async () => Promise.resolve());
}

function button(label: RegExp) {
  const match = [...container.querySelectorAll('button')].find((item) =>
    label.test(item.textContent ?? '')
  );
  if (!match) throw new Error(`Button ${String(label)} was not found`);
  return match;
}

function toggle(label: RegExp) {
  const match = [...container.querySelectorAll('label')]
    .find((item) => label.test(item.textContent ?? ''))
    ?.querySelector('input');
  if (!match) throw new Error(`Toggle ${String(label)} was not found`);
  return match;
}

async function click(element: HTMLElement) {
  await act(async () => element.click());
}

async function input(element: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('renderer experience', () => {
  it('shows the whole setup in one screen and finishes onboarding', async () => {
    const { completeOnboarding } = installApi(false);
    await renderApp();
    expect(container.textContent).toContain('Set up Roon Presence');
    expect(container.textContent).toContain('Connect Roon');
    expect(container.textContent).toContain('Choose a zone');
    expect(container.textContent).toContain('Discord');
    expect(container.textContent).toContain('Use MusicBrainz artwork matching');

    await click(button(/open dashboard/i));

    expect(completeOnboarding).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('Now playing');
  });

  it('makes automatic discovery and manual connection explicit', async () => {
    const { updateSettings } = installApi(false);
    await renderApp();

    await click(button(/manual address/i));
    const host = container.querySelector<HTMLInputElement>('input[aria-label="Roon Server host"]');
    expect(host).toBeTruthy();
    expect(container.textContent).toContain('Use this when automatic discovery is blocked');
    expect(updateSettings).not.toHaveBeenCalled();

    await input(host!, '192.168.50.2');
    await click(button(/save and connect/i));
    expect(updateSettings).toHaveBeenCalledTimes(1);
    expect(updateSettings).toHaveBeenLastCalledWith({
      manualRoonHost: '192.168.50.2',
      manualRoonPort: null
    });

    await click(button(/automatic discovery/i));
    expect(updateSettings).toHaveBeenLastCalledWith({
      manualRoonHost: '',
      manualRoonPort: null
    });
    expect(container.querySelector('input[aria-label="Roon Server host"]')).toBeFalsy();
  });

  it('shows an actionable Local Network recovery state', async () => {
    installApi(true);
    window.rrp!.getSnapshot = vi.fn().mockResolvedValue({
      ...snapshot(true),
      roon: {
        status: 'error' as const,
        reason: 'local-network-blocked' as const,
        message: 'Local Network access is blocked'
      }
    });
    await renderApp();

    expect(container.textContent).toContain('Local Network access is blocked');
    await click(button(/open local network settings/i));
    expect(window.rrp!.openLocalNetworkSettings).toHaveBeenCalledOnce();
  });

  it('synchronizes a saved manual form after an authoritative forget', async () => {
    installApi(true);
    let publish: ((value: AppSnapshot) => void) | undefined;
    const initial = {
      ...snapshot(true),
      settings: {
        ...snapshot(true).settings,
        manualRoonHost: '192.168.50.2',
        manualRoonPort: 9331
      }
    };
    window.rrp!.getSnapshot = vi.fn().mockResolvedValue(initial);
    window.rrp!.subscribe = vi.fn((callback) => {
      publish = callback;
      return () => undefined;
    });
    await renderApp();
    expect(
      container.querySelector<HTMLInputElement>('input[aria-label="Roon Server host"]')?.value
    ).toBe('192.168.50.2');

    await act(async () => publish?.(snapshot(true)));
    expect(container.querySelector('input[aria-label="Roon Server host"]')).toBeFalsy();
  });

  it('does not overwrite active manual edits when an authoritative snapshot changes', async () => {
    installApi(true);
    let publish: ((value: AppSnapshot) => void) | undefined;
    const initial = {
      ...snapshot(true),
      settings: { ...snapshot(true).settings, manualRoonHost: '192.168.50.2' }
    };
    window.rrp!.getSnapshot = vi.fn().mockResolvedValue(initial);
    window.rrp!.subscribe = vi.fn((callback) => {
      publish = callback;
      return () => undefined;
    });
    await renderApp();
    const host = container.querySelector<HTMLInputElement>('input[aria-label="Roon Server host"]')!;
    await input(host, 'edited.local');

    await act(async () => publish?.(snapshot(true)));
    expect(host.value).toBe('edited.local');
    expect(container.querySelector('input[aria-label="Roon Server host"]')).toBe(host);
  });

  it('renders playback and persists preference toggles', async () => {
    const { updateSettings } = installApi(true);
    await renderApp();
    expect(container.textContent).toContain('Midnight City');
    expect(container.textContent).toContain('M83');

    await click(toggle(/^Album/));
    expect(updateSettings).toHaveBeenCalledWith({ showAlbum: false });

    expect(container.textContent).toContain('Living room');
    await click(toggle(/^Zone/));
    expect(updateSettings).toHaveBeenCalledWith({ showZone: false });
  });

  it('renders the mapped presence and never claims it is published without Discord', async () => {
    installApi(true);
    window.rrp!.getSnapshot = vi.fn().mockResolvedValue({
      ...snapshot(true),
      presence: {
        ...snapshot(true).presence,
        details: 'Mapped by the core',
        state: 'The exact Discord state'
      },
      discord: { status: 'waiting' as const, message: 'Open Discord' }
    });

    await renderApp();

    expect(container.textContent).toContain('Mapped by the core');
    expect(container.textContent).toContain('The exact Discord state');
    expect(container.textContent).toContain('Waiting for Discord');
    expect(container.textContent).not.toContain('Published');
  });

  it('rolls back an optimistic setting when persistence fails', async () => {
    const { updateSettings } = installApi(true);
    updateSettings.mockRejectedValueOnce(new Error('disk full'));
    await renderApp();

    const albumToggle = toggle(/^Album/);
    expect(albumToggle.checked).toBe(true);

    await click(albumToggle);
    await act(async () => Promise.resolve());

    expect(albumToggle.checked).toBe(true);
    expect(container.textContent).toContain('previous choice was restored');
  });

  it('ignores an older settings response that resolves after a newer update', async () => {
    const { updateSettings } = installApi(true);
    const first = deferred<ReturnType<typeof snapshot>>();
    const second = deferred<ReturnType<typeof snapshot>>();
    updateSettings
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    await renderApp();

    const album = toggle(/^Album/);
    const zone = toggle(/^Zone/);
    await click(album);
    await click(zone);

    second.resolve({
      ...snapshot(true),
      settings: { ...snapshot(true).settings, showAlbum: false, showZone: false }
    });
    await act(async () => second.promise);
    first.resolve({
      ...snapshot(true),
      settings: { ...snapshot(true).settings, showAlbum: false, showZone: true }
    });
    await act(async () => first.promise);

    expect(album.checked).toBe(false);
    expect(zone.checked).toBe(false);
  });

  it('ignores an older settings rejection after a newer update succeeds', async () => {
    const { updateSettings } = installApi(true);
    const first = deferred<ReturnType<typeof snapshot>>();
    const second = deferred<ReturnType<typeof snapshot>>();
    updateSettings
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    await renderApp();
    const album = toggle(/^Album/);
    const zone = toggle(/^Zone/);
    await click(album);
    await click(zone);

    second.resolve({
      ...snapshot(true),
      settings: { ...snapshot(true).settings, showAlbum: false, showZone: false }
    });
    await act(async () => second.promise);
    first.reject(new Error('older write failed'));
    await act(async () => first.promise.catch(() => undefined));

    expect(album.checked).toBe(false);
    expect(zone.checked).toBe(false);
    expect(container.textContent).not.toContain('previous choice was restored');
  });

  it('stays in onboarding when completion cannot be persisted', async () => {
    const { completeOnboarding } = installApi(false);
    completeOnboarding.mockRejectedValueOnce(new Error('write failed'));
    await renderApp();

    await click(button(/open dashboard/i));
    await act(async () => Promise.resolve());

    expect(container.textContent).toContain('Set up Roon Presence');
    expect(container.textContent).toContain('Setup could not be completed');
    expect(container.textContent).not.toContain('Now playing');
  });

  it('persists a selected playback zone', async () => {
    const { updateSettings } = installApi(true);
    await renderApp();
    const automaticZone = button(/follow the active zone/i);
    expect(automaticZone.getAttribute('role')).toBe('radio');
    expect(automaticZone.getAttribute('aria-checked')).toBe('false');
    await click(automaticZone);
    expect(updateSettings).toHaveBeenCalledWith({ zoneMode: 'automatic' });
  });

  it('requires confirmation before forgetting Roon', async () => {
    const { forgetRoon } = installApi(true);
    await renderApp();

    await click(button(/forget roon authorization/i));
    expect(forgetRoon).not.toHaveBeenCalled();
    expect(button(/confirm forget roon/i)).toBeTruthy();

    await click(button(/confirm forget roon/i));
    expect(forgetRoon).toHaveBeenCalledOnce();
  });
});

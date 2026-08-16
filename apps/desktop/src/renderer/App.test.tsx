// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

const snapshot = (onboardingComplete: boolean) => ({
  version: '0.1.0',
  settings: {
    schemaVersion: 1 as const,
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
  artwork: { status: 'connected' as const, message: 'Matched' },
  diagnostics: []
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
    openExternal: vi.fn().mockResolvedValue(true),
    subscribe: vi.fn().mockReturnValue(() => undefined)
  };
  return { updateSettings, completeOnboarding, forgetRoon };
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

async function click(element: HTMLElement) {
  await act(async () => element.click());
}

describe('renderer experience', () => {
  it('guides the user through all four onboarding stages', async () => {
    const { completeOnboarding } = installApi(false);
    await renderApp();
    expect(container.textContent).toContain('Your music, beautifully present.');
    expect(container.querySelector('[data-testid="window-drag-region"]')).toBeFalsy();
    expect(container.textContent).toContain('Use MusicBrainz artwork matching');

    await click(button(/continue/i));
    expect(container.textContent).toContain('Your Roon Server is connected.');
    await click(button(/continue/i));
    expect(container.textContent).toContain('Which room speaks for you?');
    await click(button(/continue/i));
    expect(container.textContent).toContain('Discord is ready.');
    await click(button(/open dashboard/i));

    expect(completeOnboarding).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('Now playing');
  });

  it('makes automatic discovery and manual connection explicit', async () => {
    const { updateSettings } = installApi(false);
    await renderApp();
    await click(button(/continue/i));

    await click(button(/manual address/i));
    expect(container.querySelector('input[aria-label="Roon Server host"]')).toBeTruthy();
    expect(container.textContent).toContain('Use this only when local discovery is blocked');

    await click(button(/automatic discovery/i));
    expect(updateSettings).toHaveBeenCalledWith({ manualRoonHost: '' });
    expect(container.querySelector('input[aria-label="Roon Server host"]')).toBeFalsy();
  });

  it('renders playback and persists dashboard toggles', async () => {
    const { updateSettings } = installApi(true);
    await renderApp();
    expect(container.textContent).toContain('Midnight City');
    expect(container.textContent).toContain('M83');

    const albumToggle = [...container.querySelectorAll('label')]
      .find((label) => label.textContent?.includes('Album'))
      ?.querySelector('input');
    expect(albumToggle).toBeTruthy();
    await click(albumToggle!);
    expect(updateSettings).toHaveBeenCalledWith({ showAlbum: false });

    const zoneToggle = [...container.querySelectorAll('label')]
      .find((label) => label.textContent?.includes('Zone'))
      ?.querySelector('input');
    expect(zoneToggle).toBeTruthy();
    expect(container.textContent).toContain('Living room');
    await click(zoneToggle!);
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

    const albumToggle = [...container.querySelectorAll('label')]
      .find((label) => label.textContent?.includes('Album'))
      ?.querySelector('input');
    expect(albumToggle).toBeTruthy();
    expect(albumToggle!.checked).toBe(true);

    await click(albumToggle!);
    await act(async () => Promise.resolve());

    expect(albumToggle!.checked).toBe(true);
    expect(container.textContent).toContain('previous choice was restored');
  });

  it('stays in onboarding when completion cannot be persisted', async () => {
    const { completeOnboarding } = installApi(false);
    completeOnboarding.mockRejectedValueOnce(new Error('write failed'));
    await renderApp();

    await click(button(/continue/i));
    await click(button(/continue/i));
    await click(button(/continue/i));
    await click(button(/open dashboard/i));
    await act(async () => Promise.resolve());

    expect(container.textContent).toContain('Discord is ready.');
    expect(container.textContent).toContain('Setup could not be completed');
    expect(container.textContent).not.toContain('Presence details');
  });

  it('persists a selected playback zone', async () => {
    const { updateSettings } = installApi(true);
    await renderApp();
    await click(button(/^settings$/i));
    const automaticZone = button(/follow the active zone/i);
    expect(automaticZone.getAttribute('role')).toBe('radio');
    expect(automaticZone.getAttribute('aria-checked')).toBe('false');
    await click(automaticZone);
    expect(updateSettings).toHaveBeenCalledWith({ zoneMode: 'automatic' });
  });

  it('requires confirmation before forgetting Roon', async () => {
    const { forgetRoon } = installApi(true);
    await renderApp();
    await click(button(/^settings$/i));

    await click(button(/forget roon authorization/i));
    expect(forgetRoon).not.toHaveBeenCalled();
    expect(button(/confirm forget roon/i)).toBeTruthy();

    await click(button(/confirm forget roon/i));
    expect(forgetRoon).toHaveBeenCalledOnce();
  });
});

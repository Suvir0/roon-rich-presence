import type { AppSnapshot, ConnectionStatus, RoonConnectionReason, ThemeMode } from '../shared/contracts';

export type PlaybackKind = 'playing' | 'paused' | 'loading' | 'stopped';

export interface UiPresence {
  details: string;
  state: string | undefined;
  largeImage: string | undefined;
  smallText: string | undefined;
  startTimestamp: number | undefined;
  endTimestamp: number | undefined;
  paused: boolean;
}

export interface UiZone {
  id: string;
  name: string;
  state: PlaybackKind;
}

export interface UiSettings {
  theme: ThemeMode;
  presenceEnabled: boolean;
  zoneMode: 'selected' | 'automatic';
  selectedZoneId: string | undefined;
  showAlbum: boolean;
  showProgress: boolean;
  showZone: boolean;
  showWhenPaused: boolean;
  artworkLookupEnabled: boolean;
  startAtLogin: boolean;
  launchHidden: boolean;
  manualRoonHost: string | undefined;
  manualRoonPort: number | undefined;
}

export interface UiSnapshot {
  onboardingComplete: boolean;
  settings: UiSettings;
  roon: { status: ConnectionStatus; message: string; reason: RoonConnectionReason | undefined };
  discord: { status: ConnectionStatus; message: string };
  artwork: ConnectionStatus;
  zones: UiZone[];
  playback:
    | {
        zoneId: string;
        zoneName: string;
        state: PlaybackKind;
        track: string | undefined;
        artist: string | undefined;
        album: string | undefined;
        positionSeconds: number | undefined;
        durationSeconds: number | undefined;
        artworkUrl: string | undefined;
      }
    | undefined;
  presence: UiPresence | undefined;
  secureStorageAvailable: boolean;
  version: string | undefined;
}

export const EMPTY_SNAPSHOT: UiSnapshot = {
  onboardingComplete: false,
  settings: {
    theme: 'light',
    presenceEnabled: true,
    zoneMode: 'selected',
    selectedZoneId: undefined,
    showAlbum: true,
    showProgress: true,
    showZone: true,
    showWhenPaused: false,
    artworkLookupEnabled: false,
    startAtLogin: false,
    launchHidden: false,
    manualRoonHost: undefined,
    manualRoonPort: undefined
  },
  roon: { status: 'idle', message: '', reason: undefined },
  discord: { status: 'idle', message: '' },
  artwork: 'idle',
  zones: [],
  playback: undefined,
  presence: undefined,
  secureStorageAvailable: true,
  version: undefined
};

export function toUiSnapshot(snapshot: AppSnapshot): UiSnapshot {
  const { settings } = snapshot;
  return {
    onboardingComplete: settings.onboardingComplete,
    settings: {
      theme: settings.theme,
      presenceEnabled: settings.presenceEnabled,
      zoneMode: settings.zoneMode,
      selectedZoneId: settings.selectedZoneId,
      showAlbum: settings.showAlbum,
      showProgress: settings.showProgress,
      showZone: settings.showZone,
      showWhenPaused: settings.showWhenPaused,
      artworkLookupEnabled: settings.artworkLookupEnabled,
      startAtLogin: settings.startAtLogin,
      launchHidden: settings.launchHidden,
      manualRoonHost: settings.manualRoonHost,
      manualRoonPort: settings.manualRoonPort
    },
    roon: { status: snapshot.roon.status, message: snapshot.roon.message, reason: snapshot.roon.reason },
    discord: { status: snapshot.discord.status, message: snapshot.discord.message },
    artwork: snapshot.artwork.status,
    zones: snapshot.zones.map((zone) => ({ id: zone.id, name: zone.name, state: zone.state })),
    playback: snapshot.playback
      ? {
          zoneId: snapshot.playback.zoneId,
          zoneName: snapshot.playback.zoneName,
          state: snapshot.playback.state,
          track: snapshot.playback.track,
          artist: snapshot.playback.artist,
          album: snapshot.playback.album,
          positionSeconds: snapshot.playback.positionSeconds,
          durationSeconds: snapshot.playback.durationSeconds,
          artworkUrl: snapshot.playback.artworkUrl
        }
      : undefined,
    presence: snapshot.presence
      ? {
          details: snapshot.presence.details,
          state: snapshot.presence.state,
          largeImage: snapshot.presence.largeImage,
          smallText: snapshot.presence.smallText,
          startTimestamp: snapshot.presence.startTimestamp,
          endTimestamp: snapshot.presence.endTimestamp,
          paused: snapshot.presence.paused ?? false
        }
      : undefined,
    secureStorageAvailable: !snapshot.securityWarning,
    version: snapshot.version
  };
}

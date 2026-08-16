export type PlaybackStatus = 'playing' | 'paused' | 'loading' | 'stopped';
export type ConnectionStatus = 'idle' | 'searching' | 'connected' | 'waiting' | 'error';

export interface PlaybackState {
  zoneId: string;
  zoneName: string;
  state: PlaybackStatus;
  track?: string;
  artist?: string;
  album?: string;
  positionSeconds?: number;
  durationSeconds?: number;
  imageKey?: string;
  artworkUrl?: string;
}

export interface ZoneSummary {
  id: string;
  name: string;
  state: PlaybackStatus;
}

export interface AppSettings {
  schemaVersion: 1;
  presenceEnabled: boolean;
  zoneMode: 'selected' | 'automatic';
  selectedZoneId?: string;
  showAlbum: boolean;
  showProgress: boolean;
  showZone: boolean;
  showWhenPaused: boolean;
  artworkLookupEnabled: boolean;
  startAtLogin: boolean;
  launchHidden: boolean;
  automaticUpdates: boolean;
  onboardingComplete: boolean;
  manualRoonHost?: string;
  manualRoonPort?: number;
}

export interface PresencePreview {
  details: string;
  state?: string;
  largeImage?: string;
  largeText?: string;
  smallText?: string;
  startTimestamp?: number;
  endTimestamp?: number;
  paused?: boolean;
}

export interface AppSnapshot {
  version: string;
  settings: AppSettings;
  playback?: PlaybackState;
  zones: ZoneSummary[];
  activeZoneId?: string;
  presence?: PresencePreview;
  roon: { status: ConnectionStatus; message: string; serverName?: string };
  discord: { status: ConnectionStatus; message: string };
  artwork: { status: ConnectionStatus; message: string; url?: string };
  securityWarning?: string;
  diagnostics: string[];
}

export interface RrpApi {
  getSnapshot(): Promise<AppSnapshot>;
  updateSettings(patch: Partial<AppSettings>): Promise<AppSnapshot>;
  completeOnboarding(): Promise<AppSnapshot>;
  forgetRoon(): Promise<AppSnapshot>;
  copyDiagnostics(): Promise<boolean>;
  openExternal(url: string): Promise<boolean>;
  subscribe(callback: (snapshot: AppSnapshot) => void): () => void;
}

export const IPC_CHANNELS = {
  getSnapshot: 'rrp:get-snapshot',
  updateSettings: 'rrp:update-settings',
  completeOnboarding: 'rrp:complete-onboarding',
  forgetRoon: 'rrp:forget-roon',
  copyDiagnostics: 'rrp:copy-diagnostics',
  openExternal: 'rrp:open-external',
  snapshot: 'rrp:snapshot'
} as const;

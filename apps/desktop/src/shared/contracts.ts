export type PlaybackStatus = 'playing' | 'paused' | 'loading' | 'stopped';
export type ConnectionStatus = 'idle' | 'searching' | 'connected' | 'waiting' | 'error';
export type RoonConnectionReason =
  | 'authorization-required'
  | 'discovery-timeout'
  | 'endpoint-unreachable'
  | 'local-network-blocked'
  | 'reconnecting';

export interface RoonEndpoint {
  host: string;
  port: number;
}

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
  schemaVersion: 2;
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

export type AppSettingsPatch = Omit<Partial<AppSettings>, 'manualRoonPort'> & {
  /** `null` explicitly clears a previously saved advanced port override. */
  manualRoonPort?: number | null;
};

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
  roon: {
    status: ConnectionStatus;
    message: string;
    reason?: RoonConnectionReason;
    serverName?: string;
  };
  discord: { status: ConnectionStatus; message: string };
  artwork: { status: ConnectionStatus; message: string; url?: string };
  securityWarning?: string;
}

export interface RrpApi {
  getSnapshot(): Promise<AppSnapshot>;
  updateSettings(patch: AppSettingsPatch): Promise<AppSnapshot>;
  completeOnboarding(): Promise<AppSnapshot>;
  forgetRoon(): Promise<AppSnapshot>;
  copyDiagnostics(): Promise<boolean>;
  openLocalNetworkSettings(): Promise<boolean>;
  openExternal(url: string): Promise<boolean>;
  subscribe(callback: (snapshot: AppSnapshot) => void): () => void;
}

export const IPC_CHANNELS = {
  getSnapshot: 'rrp:get-snapshot',
  updateSettings: 'rrp:update-settings',
  completeOnboarding: 'rrp:complete-onboarding',
  forgetRoon: 'rrp:forget-roon',
  copyDiagnostics: 'rrp:copy-diagnostics',
  openLocalNetworkSettings: 'rrp:open-local-network-settings',
  openExternal: 'rrp:open-external',
  snapshot: 'rrp:snapshot'
} as const;

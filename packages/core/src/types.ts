export type PlaybackStatus = 'playing' | 'paused' | 'loading' | 'stopped';

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
}

export interface AppSettings {
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
}

export type ServiceStatus = 'connected' | 'connecting' | 'disconnected' | 'error';

export interface AppSnapshot {
  settings: AppSettings;
  zones: PlaybackState[];
  activeZoneId?: string;
  playback?: PlaybackState;
  roonStatus: ServiceStatus;
  discordStatus: ServiceStatus;
  artworkStatus: 'disabled' | 'idle' | 'loading' | 'matched' | 'unavailable';
  secureStorageAvailable: boolean;
}

export interface ActivityTimestamps {
  /** Unix epoch seconds. */
  start: number;
  /** Unix epoch seconds. */
  end?: number;
}

/** Transport-neutral payload consumed by the native Discord bridge. */
export interface ActivityPayload {
  type: 'listening';
  details: string;
  state?: string;
  largeImage?: string;
  largeText?: string;
  smallImage?: string;
  smallText?: string;
  timestamps?: ActivityTimestamps;
}

export type DesiredPresence = { kind: 'set'; activity: ActivityPayload } | { kind: 'clear' };

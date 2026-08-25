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

/** The presence-relevant subset of application settings consumed by `mapPresence`. */
export interface PresenceSettings {
  presenceEnabled: boolean;
  showAlbum: boolean;
  showProgress: boolean;
  showZone: boolean;
  showWhenPaused: boolean;
}

/** The zone-relevant subset of application settings consumed by `selectActiveZone`. */
export interface ZoneSelectionSettings {
  zoneMode: 'selected' | 'automatic';
  selectedZoneId?: string;
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

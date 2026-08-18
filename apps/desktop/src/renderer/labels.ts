import type { ConnectionStatus, RoonConnectionReason } from '../shared/contracts';

export const STATUS_DOT: Record<ConnectionStatus, string> = {
  connected: 'connected',
  searching: 'searching',
  waiting: 'waiting',
  error: 'error',
  idle: 'idle'
};

export const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connected: 'Connected',
  searching: 'Searching',
  waiting: 'Enable in Roon',
  error: 'Error',
  idle: 'Off'
};

export const RECOVERY_COPY: Record<RoonConnectionReason, { title: string; body: string }> = {
  'local-network-blocked': {
    title: 'Local Network access is blocked',
    body: 'Allow Roon Rich Presence in macOS System Settings, then return here. The app retries automatically.'
  },
  'discovery-timeout': {
    title: 'No Roon Server was found',
    body: 'Check that this computer and Roon Server share a network, or use a manual address.'
  },
  'endpoint-unreachable': {
    title: 'The saved Roon Server is unreachable',
    body: 'Its address or API port may have changed. Switch to automatic discovery or update the manual address.'
  },
  'authorization-required': {
    title: 'Roon Server needs to enable this extension',
    body: 'Open Roon → Settings → Extensions, find Roon Rich Presence, and press Enable.'
  },
  reconnecting: {
    title: 'Reconnecting to Roon Server',
    body: 'The connection was lost. Roon Rich Presence is retrying automatically.'
  }
};

export const DELIVERY_NOTE: Record<string, string> = {
  live: 'This is the activity currently sent to Discord.',
  waiting: 'Open Discord on this computer to publish this activity.',
  error: 'Discord could not receive the activity. Reopen Discord and try again.',
  disabled: 'Sharing is turned off. Nothing is leaving this computer.',
  paused: 'A timestamp-free paused activity is being shared.',
  idle: 'Nothing is being sent to Discord.'
};

export function formatTime(seconds?: number): string {
  if (seconds == null) return '—:—';
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

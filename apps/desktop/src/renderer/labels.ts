import type { ConnectionStatus, RoonConnectionReason } from '../shared/contracts';

export const STATUS_DOT: Record<ConnectionStatus, string> = {
  connected: 'connected',
  searching: 'searching',
  waiting: 'searching',
  error: 'error',
  idle: 'disconnected'
};

export const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connected: 'Connected',
  searching: 'Searching…',
  waiting: 'Enable in Roon',
  error: 'Error',
  idle: 'Off'
};

export const RECOVERY_COPY: Partial<
  Record<RoonConnectionReason, { title: string; body: string }>
> = {
  'local-network-blocked': {
    title: 'Local Network access is blocked',
    body: 'Allow Roon Rich Presence in macOS System Settings, then return here. The app will retry automatically.'
  },
  'discovery-timeout': {
    title: 'No Roon Server was found',
    body: 'Check that this computer and Roon Server are on the same network, or use a manual address.'
  },
  'endpoint-unreachable': {
    title: 'The saved Roon Server is unreachable',
    body: 'Its address or API port may have changed. Switch to Automatic discovery or update the manual address.'
  }
};

export function formatTime(seconds?: number): string {
  if (seconds == null) return '—:—';
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

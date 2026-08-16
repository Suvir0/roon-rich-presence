import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AppSettingsPatch, RoonConnectionReason } from '../shared/contracts';

type PlaybackState = 'playing' | 'paused' | 'loading' | 'stopped';
type ConnectionState = 'connected' | 'connecting' | 'disconnected' | 'error';
type RoonConnectionStatus = 'idle' | 'searching' | 'waiting' | 'connected' | 'error';
type RoonStatus = {
  status: RoonConnectionStatus;
  message: string;
  reason: RoonConnectionReason | undefined;
};
type Presence = {
  details: string;
  state: string | undefined;
  largeImage: string | undefined;
  largeText: string | undefined;
  smallText: string | undefined;
  startTimestamp: number | undefined;
  endTimestamp: number | undefined;
  paused: boolean;
};

type Zone = { id: string; name: string; state: PlaybackState | undefined };
type Settings = {
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
  automaticUpdates: boolean;
  manualRoonHost: string | undefined;
  manualRoonPort: number | undefined;
};
type SettingsPatch = AppSettingsPatch;

type Snapshot = {
  onboardingComplete: boolean;
  settings: Settings;
  roon: RoonStatus;
  discord: ConnectionState;
  artwork: ConnectionState | 'disabled';
  zones: Zone[];
  playback:
    | {
        zoneId: string;
        zoneName: string;
        state: PlaybackState;
        track: string | undefined;
        artist: string | undefined;
        album: string | undefined;
        positionSeconds: number | undefined;
        durationSeconds: number | undefined;
        artworkUrl: string | undefined;
      }
    | undefined;
  presence: Presence | undefined;
  secureStorageAvailable: boolean;
  version: string | undefined;
  message: string | undefined;
};

const defaults: Settings = {
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
  automaticUpdates: false,
  manualRoonHost: undefined,
  manualRoonPort: undefined
};

const demo: Snapshot = {
  onboardingComplete: false,
  settings: defaults,
  roon: { status: 'idle', message: '', reason: undefined },
  discord: 'disconnected',
  artwork: 'disabled',
  zones: [],
  playback: undefined,
  presence: undefined,
  secureStorageAvailable: true,
  version: undefined,
  message: undefined
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const text = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback);
const bool = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);
const number = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

function connection(value: unknown): ConnectionState {
  if (isObject(value)) value = value.status ?? value.state;
  if (value === 'searching') return 'connecting';
  return value === 'connected' || value === 'connecting' || value === 'error'
    ? value
    : 'disconnected';
}

const ROON_STATUSES: RoonConnectionStatus[] = [
  'idle',
  'searching',
  'waiting',
  'connected',
  'error'
];

function normalizeRoon(value: unknown): RoonStatus {
  if (isObject(value)) {
    const statusStr = String(value.status ?? value.state ?? '');
    const status = (
      ROON_STATUSES.includes(statusStr as RoonConnectionStatus) ? statusStr : 'idle'
    ) as RoonConnectionStatus;
    const reasonValue = text(value.reason);
    const reason = [
      'authorization-required',
      'discovery-timeout',
      'endpoint-unreachable',
      'local-network-blocked',
      'reconnecting'
    ].includes(reasonValue)
      ? (reasonValue as RoonConnectionReason)
      : undefined;
    return { status, message: text(value.message), reason };
  }
  return { status: 'idle', message: '', reason: undefined };
}

const ROON_STATUS_DOT: Record<RoonConnectionStatus, string> = {
  connected: 'connected',
  searching: 'searching',
  waiting: 'searching',
  error: 'error',
  idle: 'disconnected'
};

const ROON_STATUS_LABEL: Record<RoonConnectionStatus, string> = {
  connected: 'Connected',
  searching: 'Searching\u2026',
  waiting: 'Enable in Roon',
  error: 'Error',
  idle: 'Off'
};

function normalize(raw: unknown): Snapshot {
  if (!isObject(raw)) return demo;
  const sourceSettings = isObject(raw.settings) ? raw.settings : {};
  const sourceConnections = isObject(raw.connections) ? raw.connections : {};
  const rawPlayback = isObject(raw.playback)
    ? raw.playback
    : isObject(raw.activePlayback)
      ? raw.activePlayback
      : undefined;
  const zones = Array.isArray(raw.zones)
    ? raw.zones.filter(isObject).map((zone, index) => ({
        id: text(zone.id ?? zone.zoneId, `zone-${index}`),
        name: text(zone.name ?? zone.displayName ?? zone.zoneName, 'Unnamed zone'),
        state: ['playing', 'paused', 'loading', 'stopped'].includes(text(zone.state))
          ? (zone.state as PlaybackState)
          : undefined
      }))
    : [];
  const rawArtwork = isObject(raw.artwork) ? raw.artwork : undefined;
  const rawPresence = isObject(raw.presence) ? raw.presence : undefined;
  const artworkValue = raw.artworkStatus ?? sourceConnections.artwork ?? rawArtwork;
  return {
    onboardingComplete: bool(
      raw.onboardingComplete ?? raw.hasCompletedOnboarding ?? sourceSettings.onboardingComplete,
      false
    ),
    settings: {
      ...defaults,
      presenceEnabled: bool(sourceSettings.presenceEnabled, defaults.presenceEnabled),
      zoneMode: sourceSettings.zoneMode === 'automatic' ? 'automatic' : 'selected',
      selectedZoneId: text(sourceSettings.selectedZoneId) || undefined,
      showAlbum: bool(sourceSettings.showAlbum, defaults.showAlbum),
      showProgress: bool(sourceSettings.showProgress, defaults.showProgress),
      showZone: bool(sourceSettings.showZone, defaults.showZone),
      showWhenPaused: bool(sourceSettings.showWhenPaused, defaults.showWhenPaused),
      artworkLookupEnabled: bool(
        sourceSettings.artworkLookupEnabled,
        defaults.artworkLookupEnabled
      ),
      startAtLogin: bool(sourceSettings.startAtLogin, defaults.startAtLogin),
      launchHidden: bool(sourceSettings.launchHidden, defaults.launchHidden),
      automaticUpdates: bool(sourceSettings.automaticUpdates, defaults.automaticUpdates),
      manualRoonHost: text(sourceSettings.manualRoonHost) || undefined,
      manualRoonPort: number(sourceSettings.manualRoonPort)
    },
    roon: normalizeRoon(raw.roonStatus ?? sourceConnections.roon ?? raw.roon),
    discord: connection(raw.discordStatus ?? sourceConnections.discord ?? raw.discord),
    artwork: artworkValue === 'disabled' ? 'disabled' : connection(artworkValue),
    zones,
    playback: rawPlayback
      ? {
          zoneId: text(rawPlayback.zoneId),
          zoneName: text(rawPlayback.zoneName, 'Unknown zone'),
          state: ['playing', 'paused', 'loading', 'stopped'].includes(text(rawPlayback.state))
            ? (rawPlayback.state as PlaybackState)
            : 'stopped',
          track: text(rawPlayback.track) || undefined,
          artist: text(rawPlayback.artist) || undefined,
          album: text(rawPlayback.album) || undefined,
          positionSeconds: number(rawPlayback.positionSeconds ?? rawPlayback.seekPosition),
          durationSeconds: number(rawPlayback.durationSeconds ?? rawPlayback.duration),
          artworkUrl:
            text(rawPlayback.artworkUrl ?? rawPlayback.coverUrl ?? rawArtwork?.url) || undefined
        }
      : undefined,
    presence:
      rawPresence && text(rawPresence.details)
        ? {
            details: text(rawPresence.details),
            state: text(rawPresence.state) || undefined,
            largeImage: text(rawPresence.largeImage) || undefined,
            largeText: text(rawPresence.largeText) || undefined,
            smallText: text(rawPresence.smallText) || undefined,
            startTimestamp: number(rawPresence.startTimestamp),
            endTimestamp: number(rawPresence.endTimestamp),
            paused: bool(rawPresence.paused, false)
          }
        : undefined,
    secureStorageAvailable: bool(raw.secureStorageAvailable, !raw.securityWarning),
    version: text(raw.version) || undefined,
    message: text(raw.message ?? raw.error ?? raw.securityWarning) || undefined
  };
}

function Icon({ name }: { name: 'wave' | 'home' | 'settings' | 'shield' | 'copy' | 'external' }) {
  const paths: Record<typeof name, ReactNode> = {
    wave: <path d="M3 12h3l2-7 4 14 3-11 2 4h4" />,
    home: <path d="m3 11 9-8 9 8v9a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z" />,
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
      </>
    ),
    shield: <path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Zm-3-10 2 2 4-5" />,
    copy: (
      <>
        <rect x="8" y="8" width="12" height="12" rx="2" />
        <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
      </>
    ),
    external: (
      <>
        <path d="M14 3h7v7M10 14 21 3" />
        <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
      </>
    )
  };
  return (
    <svg
      aria-hidden="true"
      className="icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}

function Logo() {
  return (
    <div className="logo" aria-label="Roon Rich Presence">
      <span>
        <Icon name="wave" />
      </span>
      <strong>Roon Presence</strong>
    </div>
  );
}

function Status({
  label,
  dotClass,
  statusLabel
}: {
  label: string;
  dotClass: string;
  statusLabel: string;
}) {
  return (
    <div className="status">
      <span className={`dot ${dotClass}`} />
      <span>
        <small>{label}</small>
        <strong>{statusLabel}</strong>
      </span>
    </div>
  );
}

function Toggle({
  label,
  description,
  checked,
  disabled = false,
  onChange
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={`toggle-row ${disabled ? 'disabled' : ''}`}>
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="toggle" aria-hidden="true">
        <span />
      </span>
    </label>
  );
}

function formatTime(seconds?: number) {
  if (seconds == null) return '—:—';
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

function Artwork({ snapshot, large = false }: { snapshot: Snapshot; large?: boolean }) {
  const title = snapshot.playback?.track ?? 'Nothing playing';
  const artworkUrl = snapshot.playback?.artworkUrl;
  const [brokenUrl, setBrokenUrl] = useState<string>();
  const broken = Boolean(artworkUrl && artworkUrl === brokenUrl);
  return (
    <div className={`artwork ${large ? 'large' : ''}`}>
      {artworkUrl && !broken ? (
        <img
          src={artworkUrl}
          alt={`Cover art for ${title}`}
          onError={() => setBrokenUrl(artworkUrl)}
        />
      ) : (
        <div className="artwork-fallback">
          <Icon name="wave" />
          <span>RP</span>
        </div>
      )}
      {snapshot.playback?.state === 'playing' && (
        <span className="playing-bars" aria-label="Playing">
          <i />
          <i />
          <i />
        </span>
      )}
    </div>
  );
}

function PresencePreview({ snapshot }: { snapshot: Snapshot }) {
  const playback = snapshot.playback;
  const presence = snapshot.presence;
  const position = playback?.positionSeconds ?? 0;
  const duration = playback?.durationSeconds ?? 0;
  const progress = duration > 0 ? Math.min(100, Math.max(0, (position / duration) * 100)) : 0;
  const hasPublishedProgress = Boolean(
    presence?.startTimestamp && presence.endTimestamp && duration > 0
  );
  const delivery = !snapshot.settings.presenceEnabled
    ? { label: 'Disabled', className: 'disabled' }
    : snapshot.discord !== 'connected'
      ? {
          label: snapshot.discord === 'error' ? 'Discord error' : 'Waiting for Discord',
          className: snapshot.discord === 'error' ? 'error' : 'waiting'
        }
      : presence
        ? {
            label: presence.paused ? 'Paused' : 'Published',
            className: presence.paused ? 'paused' : 'live'
          }
        : { label: 'Idle', className: 'idle' };
  return (
    <section className="card presence-card" aria-labelledby="preview-heading">
      <div className="eyebrow-row">
        <h2 id="preview-heading">Discord activity</h2>
        <span className={`live-pill ${delivery.className}`}>
          <span aria-hidden="true" /> {delivery.label}
        </span>
      </div>
      <div className="presence-content">
        <Artwork snapshot={snapshot} />
        <div className="presence-copy">
          <small>LISTENING TO ROON</small>
          <strong>{presence?.details ?? 'No activity published'}</strong>
          <span>{presence?.state ?? 'Your activity will appear here when it is shared.'}</span>
          {presence?.smallText && <span>{presence.smallText}</span>}
          {hasPublishedProgress && (
            <div className="mini-progress">
              <div>
                <span style={{ width: `${progress}%` }} />
              </div>
              <small>
                {formatTime(position)} <b>{formatTime(duration)}</b>
              </small>
            </div>
          )}
        </div>
      </div>
      <p className="delivery-note">
        {delivery.className === 'live'
          ? 'This is the activity currently sent to Discord.'
          : delivery.className === 'waiting'
            ? 'Open Discord on this computer to publish this activity.'
            : delivery.className === 'error'
              ? 'Discord could not receive the activity. Reopen Discord and try again.'
              : delivery.className === 'disabled'
                ? 'Sharing is turned off.'
                : delivery.className === 'paused'
                  ? 'A timestamp-free paused activity is being shared.'
                  : 'Nothing is being sent to Discord.'}
      </p>
    </section>
  );
}

function Onboarding({
  snapshot,
  onDone,
  update
}: {
  snapshot: Snapshot;
  onDone: () => Promise<void>;
  update: (patch: SettingsPatch) => void;
}) {
  const [step, setStep] = useState(0);
  const [finishing, setFinishing] = useState(false);
  const steps: Array<{ kicker: string; title: string; body: string }> = [
    {
      kicker: 'Welcome',
      title: 'Your music, beautifully present.',
      body: 'Roon Presence turns whatever is playing at home into a tasteful Discord activity. It runs locally, stays quiet in your tray or menu bar, and never needs your Discord password.'
    },
    {
      kicker: 'Connect Roon',
      title:
        snapshot.roon.status === 'connected'
          ? 'Your Roon Server is connected.'
          : snapshot.roon.status === 'waiting'
            ? 'Roon Server found — almost there.'
            : 'Let Roon discover this extension.',
      body:
        snapshot.roon.status === 'connected'
          ? 'Authorization is complete. You can revoke access at any time from Roon or the app settings.'
          : snapshot.roon.status === 'waiting'
            ? 'Open Roon Settings → Extensions, find Roon Presence, and click Enable.'
            : snapshot.roon.message ||
              'Searching your network… Once found, enable this extension in Roon Settings → Extensions. Keep this window open.'
    },
    {
      kicker: 'Choose a zone',
      title: 'Which room speaks for you?',
      body: 'Pick one zone, or let automatic mode follow a playing zone without jumping around while multiple rooms are active.'
    },
    {
      kicker: 'Discord',
      title:
        snapshot.discord === 'connected'
          ? 'Discord is ready.'
          : 'Open Discord to finish the connection.',
      body: 'No login or bot token is required. Discord must be running on this computer for your activity to appear.'
    }
  ];
  const current = steps[step] ?? steps[0]!;
  const canContinue =
    step !== 2 ||
    snapshot.settings.zoneMode === 'automatic' ||
    Boolean(snapshot.settings.selectedZoneId);
  return (
    <main className="onboarding-shell">
      <header>
        <Logo />
        <span className="local-badge">
          <Icon name="shield" /> Local & private
        </span>
      </header>
      <div className="onboarding-layout">
        <section className="onboarding-copy">
          <span className="kicker">{current.kicker}</span>
          <h1>{current.title}</h1>
          <p>{current.body}</p>
          {step === 0 && (
            <div className="consent-card">
              <div className="consent-heading">
                <span className="consent-icon">
                  <Icon name="shield" />
                </span>
                <span>
                  <strong>Add album artwork</strong>
                  <small>Recommended for the best-looking Discord card</small>
                </span>
              </div>
              <Toggle
                label="Use MusicBrainz artwork matching"
                description="Only artist and album text is sent. Listening history, account details, and local artwork stay on this computer."
                checked={snapshot.settings.artworkLookupEnabled}
                onChange={(artworkLookupEnabled) => update({ artworkLookupEnabled })}
              />
            </div>
          )}
          {step === 1 && (
            <>
              <div className="connection-panel">
                <Status
                  label="Roon Server"
                  dotClass={ROON_STATUS_DOT[snapshot.roon.status]}
                  statusLabel={ROON_STATUS_LABEL[snapshot.roon.status]}
                />
                <span className="pulse-ring" />
              </div>
              <RoonConnectionChooser snapshot={snapshot} update={update} />
            </>
          )}
          {step === 2 && <ZoneChooser snapshot={snapshot} update={update} />}
          {step === 3 && (
            <div className="connection-panel">
              <Status
                label="Discord desktop"
                dotClass={snapshot.discord}
                statusLabel={
                  snapshot.discord === 'connected'
                    ? 'Connected'
                    : snapshot.discord === 'error'
                      ? 'Error'
                      : snapshot.discord === 'connecting'
                        ? 'Connecting\u2026'
                        : 'Off'
                }
              />
              <span className="pulse-ring discord" />
            </div>
          )}
          <div className="onboarding-actions">
            {step > 0 && (
              <button className="button ghost" onClick={() => setStep(step - 1)}>
                Back
              </button>
            )}
            <button
              className="button primary"
              disabled={!canContinue || finishing}
              onClick={() => {
                if (step !== 3) {
                  setStep(step + 1);
                  return;
                }
                setFinishing(true);
                void onDone()
                  .catch(() => undefined)
                  .finally(() => setFinishing(false));
              }}
            >
              {step === 3 ? (finishing ? 'Finishing…' : 'Open dashboard') : 'Continue'}
              <span>→</span>
            </button>
          </div>
        </section>
        <div className="onboarding-visual">
          <div className="glow" />
          <PresencePreview snapshot={snapshot} />
        </div>
      </div>
      <footer>
        <div className="steps" aria-label={`Step ${step + 1} of 4`}>
          {steps.map((_, index) => (
            <span key={index} className={index === step ? 'active' : index < step ? 'done' : ''} />
          ))}
        </div>
        <small>Step {step + 1} of 4</small>
      </footer>
    </main>
  );
}

function RoonConnectionChooser({
  snapshot,
  update
}: {
  snapshot: Snapshot;
  update: (patch: SettingsPatch) => void;
}) {
  const [manual, setManual] = useState(Boolean(snapshot.settings.manualRoonHost));
  const [host, setHost] = useState(snapshot.settings.manualRoonHost ?? '');
  const [port, setPort] = useState(
    snapshot.settings.manualRoonPort ? String(snapshot.settings.manualRoonPort) : ''
  );
  const [formError, setFormError] = useState('');
  const editing = useRef(false);
  useEffect(() => {
    if (editing.current) return;
    setManual(Boolean(snapshot.settings.manualRoonHost));
    setHost(snapshot.settings.manualRoonHost ?? '');
    setPort(snapshot.settings.manualRoonPort ? String(snapshot.settings.manualRoonPort) : '');
  }, [snapshot.settings.manualRoonHost, snapshot.settings.manualRoonPort]);
  const selectAutomatic = () => {
    editing.current = false;
    setManual(false);
    setHost('');
    setPort('');
    setFormError('');
    update({ manualRoonHost: '', manualRoonPort: null });
  };
  const saveManual = () => {
    const cleanHost = host.trim();
    const cleanPort = port.trim();
    const parsedPort = cleanPort ? Number(cleanPort) : undefined;
    if (!cleanHost) {
      setFormError('Enter the IP address or hostname of your Roon Server.');
      return;
    }
    if (
      cleanHost.length > 253 ||
      (parsedPort !== undefined &&
        (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65_535))
    ) {
      setFormError('Enter a valid server address and a port from 1 to 65535.');
      return;
    }
    editing.current = false;
    setFormError('');
    update({ manualRoonHost: cleanHost, manualRoonPort: parsedPort ?? null });
  };
  const recovery =
    snapshot.roon.reason === 'local-network-blocked'
      ? {
          title: 'Local Network access is blocked',
          body: 'Allow Roon Rich Presence in macOS System Settings, then return here. The app will retry automatically.'
        }
      : snapshot.roon.reason === 'discovery-timeout'
        ? {
            title: 'No Roon Server was found',
            body: 'Check that this computer and Roon Server are on the same network, or use a manual address.'
          }
        : snapshot.roon.reason === 'endpoint-unreachable'
          ? {
              title: 'The saved Roon Server is unreachable',
              body: 'Its address or API port may have changed. Switch to Automatic discovery or update the manual address.'
            }
          : undefined;
  return (
    <div className="connection-method">
      {recovery && (
        <div className="connection-recovery" role="alert">
          <span>
            <strong>{recovery.title}</strong>
            <small>{recovery.body}</small>
          </span>
          {snapshot.roon.reason === 'local-network-blocked' && (
            <button
              className="button ghost"
              onClick={() => void window.rrp?.openLocalNetworkSettings()}
            >
              Open Local Network Settings
            </button>
          )}
        </div>
      )}
      <span className="field-label">Connection method</span>
      <div className="segmented" role="group" aria-label="Roon connection method">
        <button
          className={!manual ? 'selected' : ''}
          aria-pressed={!manual}
          onClick={selectAutomatic}
        >
          Automatic discovery
        </button>
        <button
          className={manual ? 'selected' : ''}
          aria-pressed={manual}
          onClick={() => setManual(true)}
        >
          Manual address
        </button>
      </div>
      {!manual ? (
        <p>
          Recommended. Uses Roon discovery to find the server and its current API port
          automatically.
        </p>
      ) : (
        <div className="manual-fields">
          <label>
            Server host
            <input
              aria-label="Roon Server host"
              placeholder="192.168.1.20"
              value={host}
              onChange={(event) => {
                editing.current = true;
                setHost(event.target.value);
              }}
            />
          </label>
          <details className="advanced-port" open={Boolean(port)}>
            <summary>Advanced: specify API port</summary>
            <label>
              API port (optional)
              <input
                aria-label="Roon Server port"
                inputMode="numeric"
                placeholder="Discover automatically"
                value={port}
                onChange={(event) => {
                  editing.current = true;
                  setPort(event.target.value);
                }}
              />
            </label>
            <small>Leave this empty unless Roon shows you a specific API port.</small>
          </details>
          {formError && <p className="field-error">{formError}</p>}
          <div className="manual-actions">
            <p>Use this when automatic discovery is blocked by your network.</p>
            <button className="button primary" onClick={saveManual}>
              Save and Connect
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ZoneChooser({
  snapshot,
  update
}: {
  snapshot: Snapshot;
  update: (patch: SettingsPatch) => void;
}) {
  return (
    <div className="zone-chooser" role="radiogroup" aria-label="Playback zone">
      <button
        role="radio"
        aria-checked={snapshot.settings.zoneMode === 'automatic'}
        className={snapshot.settings.zoneMode === 'automatic' ? 'selected' : ''}
        onClick={() => update({ zoneMode: 'automatic' })}
      >
        <span className="zone-icon">✦</span>
        <span>
          <strong>Automatic</strong>
          <small>Follow the active zone</small>
        </span>
        <i aria-hidden="true" />
      </button>
      {snapshot.zones.map((zone) => (
        <button
          key={zone.id}
          role="radio"
          aria-checked={
            snapshot.settings.zoneMode === 'selected' &&
            snapshot.settings.selectedZoneId === zone.id
          }
          className={
            snapshot.settings.zoneMode === 'selected' &&
            snapshot.settings.selectedZoneId === zone.id
              ? 'selected'
              : ''
          }
          onClick={() => update({ zoneMode: 'selected', selectedZoneId: zone.id })}
        >
          <span className="zone-icon">◉</span>
          <span>
            <strong>{zone.name}</strong>
            <small>{zone.state ?? 'Available'}</small>
          </span>
          <i aria-hidden="true" />
        </button>
      ))}
      {!snapshot.zones.length && (
        <p className="empty-inline">
          Zones appear here once Roon is connected. Automatic mode is available now.
        </p>
      )}
    </div>
  );
}

function NowPlaying({ snapshot }: { snapshot: Snapshot }) {
  const playback = snapshot.playback;
  const duration = playback?.durationSeconds ?? 0;
  const position = playback?.positionSeconds ?? 0;
  const progress = duration > 0 ? Math.min(100, Math.max(0, (position / duration) * 100)) : 0;
  return (
    <section className="card now-playing" aria-labelledby="now-playing-heading">
      <div className="eyebrow-row">
        <h2 id="now-playing-heading">Now playing</h2>
        <span className={`state-pill ${playback?.state ?? 'stopped'}`}>
          {playback?.state ?? 'Idle'}
        </span>
      </div>
      <div className="track-layout">
        <Artwork snapshot={snapshot} large />
        <div className="track-copy">
          <small>{playback?.zoneName ?? 'No active zone'}</small>
          <h3>{playback?.track ?? 'Waiting for music'}</h3>
          <p>{playback?.artist ?? 'Start playback in Roon to see it here.'}</p>
          {playback?.album && <span>{playback.album}</span>}
        </div>
      </div>
      <div
        className="progress"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress)}
        aria-label={
          duration > 0 ? `${Math.round(progress)} percent played` : 'Playback progress unavailable'
        }
      >
        <div>
          <span style={{ width: `${progress}%` }} />
        </div>
        <small>{formatTime(position)}</small>
        <small>{formatTime(duration)}</small>
      </div>
    </section>
  );
}

function SetupHealth({
  snapshot,
  openSettings,
  onExternal
}: {
  snapshot: Snapshot;
  openSettings: () => void;
  onExternal: (url: string) => void;
}) {
  return (
    <section className="setup-health" aria-label="Connection checklist">
      <div className={`setup-item ${snapshot.roon.status === 'connected' ? 'ready' : ''}`}>
        <span className={`dot ${ROON_STATUS_DOT[snapshot.roon.status]}`} />
        <span>
          <strong>Roon</strong>
          <small>
            {snapshot.roon.status === 'connected'
              ? 'Server connected'
              : snapshot.roon.message || 'Needs setup'}
          </small>
        </span>
        {snapshot.roon.status !== 'connected' && <button onClick={openSettings}>Connect</button>}
      </div>
      <div className={`setup-item ${snapshot.discord === 'connected' ? 'ready' : ''}`}>
        <span className={`dot ${snapshot.discord}`} />
        <span>
          <strong>Discord</strong>
          <small>
            {snapshot.discord === 'connected'
              ? 'Ready to publish'
              : snapshot.discord === 'connecting'
                ? 'Connecting\u2026'
                : snapshot.discord === 'error'
                  ? 'Connection error'
                  : 'Open Discord to connect'}
          </small>
        </span>
        {snapshot.discord !== 'connected' && (
          <button onClick={() => onExternal('https://support.discord.com/hc/en-us')}>
            Get help
          </button>
        )}
      </div>
    </section>
  );
}

function SettingsPanel({
  snapshot,
  update,
  onForget,
  onCopy,
  onExternal
}: {
  snapshot: Snapshot;
  update: (patch: SettingsPatch) => void;
  onForget: () => Promise<void>;
  onCopy: () => void;
  onExternal: (url: string) => void;
}) {
  const [confirmForget, setConfirmForget] = useState(false);
  const [forgetting, setForgetting] = useState(false);
  const forget = async () => {
    if (!confirmForget) {
      setConfirmForget(true);
      return;
    }
    if (forgetting) return;
    setForgetting(true);
    try {
      await onForget();
      setConfirmForget(false);
    } catch {
      // Keep confirmation visible so the user can retry after the error toast.
    } finally {
      setForgetting(false);
    }
  };
  return (
    <div className="settings-page">
      <section className="page-title">
        <span className="kicker">Preferences</span>
        <h1>Make it yours.</h1>
        <p>Choose what friends see and how Roon Presence behaves on this computer.</p>
      </section>
      <section className="card settings-card settings-wide">
        <div className="section-heading">
          <span>
            <h2>Roon connection</h2>
            <p>Automatic discovery is recommended for most home networks.</p>
          </span>
          <Status
            label="Roon"
            dotClass={ROON_STATUS_DOT[snapshot.roon.status]}
            statusLabel={ROON_STATUS_LABEL[snapshot.roon.status]}
          />
        </div>
        <RoonConnectionChooser snapshot={snapshot} update={update} />
        <div className="settings-divider" />
        <h3 className="setting-subtitle">Playback zone</h3>
        <ZoneChooser snapshot={snapshot} update={update} />
      </section>
      <section className="card settings-card settings-wide">
        <h2>What friends see</h2>
        <Toggle
          label="Share listening activity"
          description="Publish the selected zone to your Discord profile."
          checked={snapshot.settings.presenceEnabled}
          onChange={(presenceEnabled) => update({ presenceEnabled })}
        />
        <Toggle
          label="Show album"
          description="Add the album title beneath artist information."
          checked={snapshot.settings.showAlbum}
          onChange={(showAlbum) => update({ showAlbum })}
        />
        <Toggle
          label="Show progress"
          description="Display elapsed and remaining track time."
          checked={snapshot.settings.showProgress}
          onChange={(showProgress) => update({ showProgress })}
        />
        <Toggle
          label="Zone"
          description="Show the Roon zone name on your Discord activity."
          checked={snapshot.settings.showZone}
          onChange={(showZone) => update({ showZone })}
        />
        <Toggle
          label="Show while paused"
          description="Keep a timestamp-free paused activity visible."
          checked={snapshot.settings.showWhenPaused}
          onChange={(showWhenPaused) => update({ showWhenPaused })}
        />
      </section>
      <section className="card settings-card artwork-settings settings-wide">
        <div className="section-heading">
          <span>
            <h2>Album artwork</h2>
            <p>Add real covers to the large image on your Discord activity.</p>
          </span>
          <span className="privacy-chip">
            <Icon name="shield" /> Opt-in
          </span>
        </div>
        <Toggle
          label="Find album covers"
          description="Send artist and album text to MusicBrainz. Local artwork, history, Roon authorization, and Discord identity never leave this device."
          checked={snapshot.settings.artworkLookupEnabled}
          onChange={(artworkLookupEnabled) => update({ artworkLookupEnabled })}
        />
        <button
          className="text-button"
          onClick={() => onExternal('https://musicbrainz.org/doc/About/Privacy_Policy')}
        >
          Read the MusicBrainz privacy policy <Icon name="external" />
        </button>
      </section>
      <section className="card settings-card settings-wide">
        <h2>App behavior</h2>
        <Toggle
          label="Start at login"
          description="Launch Roon Presence when you sign in."
          checked={snapshot.settings.startAtLogin}
          onChange={(startAtLogin) => update({ startAtLogin })}
        />
        <Toggle
          label="Launch hidden"
          description={
            snapshot.settings.startAtLogin
              ? 'Start quietly in the tray or menu bar.'
              : 'Available when Start at login is enabled.'
          }
          checked={snapshot.settings.launchHidden}
          disabled={!snapshot.settings.startAtLogin}
          onChange={(launchHidden) => update({ launchHidden })}
        />
        <Toggle
          label="Automatic updates"
          description="Unavailable in unsigned beta builds. Download updates manually from GitHub Releases."
          checked={false}
          disabled
          onChange={() => undefined}
        />
      </section>
      <section className="card settings-card danger-zone">
        <div>
          <h2>Support & data</h2>
          <p>Diagnostics are local, bounded, and redact track metadata by default.</p>
        </div>
        <div className="button-row">
          <button className="button ghost" onClick={onCopy}>
            <Icon name="copy" /> Copy diagnostics
          </button>
          {confirmForget && (
            <button className="button ghost" onClick={() => setConfirmForget(false)}>
              Cancel
            </button>
          )}
          <button className="button danger" disabled={forgetting} onClick={forget}>
            {forgetting
              ? 'Forgetting…'
              : confirmForget
                ? 'Confirm forget Roon'
                : 'Forget Roon authorization'}
          </button>
        </div>
      </section>
      {!snapshot.secureStorageAvailable && (
        <div className="warning">
          <Icon name="shield" />
          <span>
            <strong>Secure storage is unavailable</strong> Your Roon authorization cannot be
            encrypted by the operating system on this device.
          </span>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const api = window.rrp;
  const [snapshot, setSnapshot] = useState<Snapshot>(demo);
  const snapshotRef = useRef(snapshot);
  const [loaded, setLoaded] = useState(() => !window.rrp);
  const [tab, setTab] = useState<'home' | 'settings'>('home');
  const [toast, setToast] = useState('');
  const settingsUpdateSequence = useRef(0);

  useEffect(() => {
    let active = true;
    api
      ?.getSnapshot()
      .then((value) => {
        if (active) {
          const next = normalize(value);
          snapshotRef.current = next;
          setSnapshot(next);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (active) setLoaded(true);
      });
    const unsubscribe = api?.subscribe((value) => {
      if (active) {
        const next = normalize(value);
        snapshotRef.current = next;
        setSnapshot(next);
      }
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [api]);

  const update = (patch: SettingsPatch) => {
    const sequence = ++settingsUpdateSequence.current;
    const previous = snapshotRef.current;
    const optimisticSettings: Settings = {
      ...previous.settings,
      ...patch,
      manualRoonPort:
        'manualRoonPort' in patch
          ? (patch.manualRoonPort ?? undefined)
          : previous.settings.manualRoonPort
    };
    const optimistic: Snapshot = { ...previous, settings: optimisticSettings };
    snapshotRef.current = optimistic;
    setSnapshot(optimistic);
    Promise.resolve(api?.updateSettings(patch))
      .then((value) => {
        if (value && sequence === settingsUpdateSequence.current) {
          const next = normalize(value);
          snapshotRef.current = next;
          setSnapshot(next);
        }
      })
      .catch(() => {
        if (sequence !== settingsUpdateSequence.current) return;
        snapshotRef.current = previous;
        setSnapshot(previous);
        setToast('That setting could not be saved. Your previous choice was restored.');
      });
  };
  const action = async (task: (() => Promise<unknown> | unknown) | undefined, success: string) => {
    try {
      await task?.();
      setToast(success);
      setTimeout(() => setToast(''), 2600);
    } catch {
      setToast('Something went wrong. Please try again.');
    }
  };
  const complete = async () => {
    try {
      const value = await api?.completeOnboarding();
      const next = value ? normalize(value) : { ...snapshotRef.current, onboardingComplete: true };
      snapshotRef.current = next;
      setSnapshot(next);
      setToast('Setup complete');
      setTimeout(() => setToast(''), 2600);
    } catch {
      setToast('Setup could not be completed. Please try again.');
      throw new Error('Onboarding completion failed');
    }
  };
  const forgetRoon = async () => {
    try {
      await api?.forgetRoon();
      setToast('Roon authorization removed');
      setTimeout(() => setToast(''), 2600);
    } catch (error) {
      setToast('Roon authorization could not be removed. Please try again.');
      throw error;
    }
  };
  const health = useMemo(
    () => snapshot.roon.status === 'connected' && snapshot.discord === 'connected',
    [snapshot.roon, snapshot.discord]
  );

  useEffect(() => {
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [tab]);

  if (!loaded)
    return (
      <div className="window-frame">
        <main className="loading">
          <Logo />
          <div className="loader" />
          <span>Starting securely…</span>
        </main>
      </div>
    );
  if (!snapshot.onboardingComplete)
    return (
      <>
        <div className="window-frame">
          <Onboarding snapshot={snapshot} onDone={complete} update={update} />
        </div>
        {toast && (
          <div className="toast" role="status">
            {toast}
          </div>
        )}
      </>
    );

  return (
    <div className="window-frame">
      <div className="app-shell">
        <aside className="sidebar">
          <Logo />
          <nav aria-label="Main navigation">
            <button
              className={tab === 'home' ? 'active' : ''}
              aria-current={tab === 'home' ? 'page' : undefined}
              onClick={() => setTab('home')}
            >
              <Icon name="home" /> Overview
            </button>
            <button
              className={tab === 'settings' ? 'active' : ''}
              aria-current={tab === 'settings' ? 'page' : undefined}
              onClick={() => setTab('settings')}
            >
              <Icon name="settings" /> Settings
            </button>
          </nav>
          <div className="sidebar-foot">
            <span className={`health ${health ? 'good' : ''}`}>
              <i />
              {health ? 'Everything connected' : 'Connection attention'}
            </span>
            <small>
              Local-first · No telemetry{snapshot.version ? ` · v${snapshot.version}` : ''}
            </small>
          </div>
        </aside>
        <div className="content-shell">
          <header className="topbar">
            <div>
              <span className="mobile-logo">
                <Logo />
              </span>
              <span className="desktop-title">{tab === 'home' ? 'Overview' : 'Settings'}</span>
            </div>
            <div className="top-status">
              <button
                className={`power ${snapshot.settings.presenceEnabled ? 'on' : ''}`}
                aria-label={
                  snapshot.settings.presenceEnabled ? 'Disable presence' : 'Enable presence'
                }
                onClick={() => update({ presenceEnabled: !snapshot.settings.presenceEnabled })}
              >
                <span>●</span>
                {snapshot.settings.presenceEnabled ? 'Presence on' : 'Presence off'}
              </button>
            </div>
          </header>
          <main className="content">
            {tab === 'home' ? (
              <>
                <section className="overview-heading">
                  <div>
                    <span className="kicker">Overview</span>
                    <h1>
                      {snapshot.playback?.state === 'playing' ? 'Now playing' : 'Roon Presence'}
                    </h1>
                    <p>
                      {snapshot.message ??
                        'Keep an eye on playback and exactly what is being shared with Discord.'}
                    </p>
                  </div>
                </section>
                <SetupHealth
                  snapshot={snapshot}
                  openSettings={() => setTab('settings')}
                  onExternal={(url) =>
                    action(() => api?.openExternal(url), 'Opened in your browser')
                  }
                />
                <div className="dashboard-grid">
                  <NowPlaying snapshot={snapshot} />
                  <PresencePreview snapshot={snapshot} />
                </div>
                <section className="card quick-settings">
                  <div>
                    <h2>Presence details</h2>
                    <p>Fine tune what friends can see without leaving the dashboard.</p>
                  </div>
                  <div className="quick-toggles">
                    <Toggle
                      label="Album"
                      description=""
                      checked={snapshot.settings.showAlbum}
                      onChange={(showAlbum) => update({ showAlbum })}
                    />
                    <Toggle
                      label="Progress"
                      description=""
                      checked={snapshot.settings.showProgress}
                      onChange={(showProgress) => update({ showProgress })}
                    />
                    <Toggle
                      label="Zone"
                      description=""
                      checked={snapshot.settings.showZone}
                      onChange={(showZone) => update({ showZone })}
                    />
                  </div>
                </section>
              </>
            ) : (
              <SettingsPanel
                snapshot={snapshot}
                update={update}
                onForget={forgetRoon}
                onCopy={() =>
                  action(api?.copyDiagnostics?.bind(api), 'Redacted diagnostics copied')
                }
                onExternal={(url) => action(() => api?.openExternal(url), 'Opened in your browser')}
              />
            )}
          </main>
        </div>
        <nav className="mobile-nav" aria-label="Main navigation">
          <button
            className={tab === 'home' ? 'active' : ''}
            aria-current={tab === 'home' ? 'page' : undefined}
            onClick={() => setTab('home')}
          >
            <Icon name="home" />
            <span>Overview</span>
          </button>
          <button
            className={tab === 'settings' ? 'active' : ''}
            aria-current={tab === 'settings' ? 'page' : undefined}
            onClick={() => setTab('settings')}
          >
            <Icon name="settings" />
            <span>Settings</span>
          </button>
        </nav>
        {toast && (
          <div className="toast" role="status">
            {toast}
          </div>
        )}
      </div>
    </div>
  );
}

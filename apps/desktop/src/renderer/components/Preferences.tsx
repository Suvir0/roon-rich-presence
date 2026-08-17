import { useState } from 'react';
import type { AppSettingsPatch } from '../../shared/contracts';
import { Icon } from './Icon';
import { RoonConnectionChooser } from './RoonConnectionChooser';
import { StatusRow } from './StatusRow';
import { Toggle } from './Toggle';
import { ZoneChooser } from './ZoneChooser';
import { STATUS_DOT, STATUS_LABEL } from '../labels';
import type { UiSnapshot } from '../snapshot';

export function Preferences({
  snapshot,
  update,
  onForget,
  onCopy,
  onExternal
}: {
  snapshot: UiSnapshot;
  update: (patch: AppSettingsPatch) => void;
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
    <div className="preferences">
      <section className="card">
        <div className="section-heading">
          <h2>Roon connection</h2>
          <StatusRow
            label="Roon"
            dotClass={STATUS_DOT[snapshot.roon.status]}
            statusLabel={STATUS_LABEL[snapshot.roon.status]}
          />
        </div>
        <RoonConnectionChooser snapshot={snapshot} update={update} />
        <div className="divider" />
        <h3 className="subtitle">Playback zone</h3>
        <ZoneChooser snapshot={snapshot} update={update} />
      </section>

      <section className="card">
        <h2>What friends see</h2>
        <Toggle
          label="Share listening activity"
          description="Publish the selected zone to your Discord profile."
          checked={snapshot.settings.presenceEnabled}
          onChange={(presenceEnabled) => update({ presenceEnabled })}
        />
        <Toggle
          label="Album"
          description="Add the album title beneath artist information."
          checked={snapshot.settings.showAlbum}
          onChange={(showAlbum) => update({ showAlbum })}
        />
        <Toggle
          label="Progress"
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

      <section className="card">
        <div className="section-heading">
          <h2>Album artwork</h2>
          <span className="privacy-chip">
            <Icon name="shield" /> Opt-in
          </span>
        </div>
        <Toggle
          label="Find album covers"
          description="Sends artist and album text to MusicBrainz. Nothing else leaves this computer."
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

      <section className="card">
        <h2>App behavior</h2>
        <Toggle
          label="Start at login"
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
        <p className="hint">
          Automatic updates are unavailable in unsigned beta builds. Download updates manually from
          GitHub Releases.
        </p>
      </section>

      <section className="card danger-zone">
        <div>
          <h2>Support &amp; data</h2>
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
            <strong>Secure storage is unavailable.</strong> Your Roon authorization cannot be
            encrypted by the operating system on this device.
          </span>
        </div>
      )}
    </div>
  );
}

import { useState } from 'react';
import type { AppSettingsPatch } from '../../shared/contracts';
import { Icon } from './Icon';
import { NowPlaying } from './NowPlaying';
import { RoonConnectionChooser } from './RoonConnectionChooser';
import { Toggle } from './Toggle';
import { ZoneChooser } from './ZoneChooser';
import { STATUS_LABEL } from '../labels';
import type { UiSnapshot } from '../snapshot';

export function Dashboard({
  snapshot,
  update,
  onForget,
  onCopy,
  onExternal,
  onBackToSetup
}: {
  snapshot: UiSnapshot;
  update: (patch: AppSettingsPatch) => void;
  onForget: () => Promise<void>;
  onCopy: () => void;
  onExternal: (url: string) => void;
  onBackToSetup: () => void;
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

  const visible = [
    snapshot.settings.showAlbum && 'Album',
    snapshot.settings.showProgress && 'Progress',
    snapshot.settings.showZone && 'Zone'
  ].filter(Boolean) as string[];

  return (
    <div className="dashboard">
      <NowPlaying snapshot={snapshot} />

      <main className="dashboard-main">
        {!snapshot.secureStorageAvailable && (
          <div className="security-warning">
            <Icon name="shield" />
            <span>
              <strong>Secure storage is unavailable.</strong> Your Roon authorization cannot be
              encrypted by the operating system on this device.
            </span>
          </div>
        )}

        <section className="section">
          <div className="section-heading">
            <h3>Roon connection</h3>
            <span className="meta">{STATUS_LABEL[snapshot.roon.status]}</span>
          </div>
          <RoonConnectionChooser snapshot={snapshot} update={update} />
        </section>

        <section className="section">
          <div className="section-heading">
            <h3>Playback zone</h3>
            <span className="meta">{snapshot.zones.length} zones found</span>
          </div>
          <ZoneChooser snapshot={snapshot} update={update} />
        </section>

        <section className="section">
          <div className="section-heading">
            <h3>What friends see</h3>
            <span className="meta">
              {visible.length ? visible.join(' · ') : 'Track and artist only'}
            </span>
          </div>
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

        <section className="section">
          <div className="section-heading">
            <h3>Album artwork</h3>
            <span className="tag tag-outline">Opt-in</span>
          </div>
          <Toggle
            label="Find album covers"
            description="Sends artist and album text to MusicBrainz. Nothing else leaves this computer."
            checked={snapshot.settings.artworkLookupEnabled}
            onChange={(artworkLookupEnabled) => update({ artworkLookupEnabled })}
          />
          <button
            className="privacy-link"
            onClick={() => onExternal('https://musicbrainz.org/doc/About/Privacy_Policy')}
          >
            Read the MusicBrainz privacy policy <Icon name="external" />
          </button>
        </section>

        <section className="section">
          <div className="section-heading">
            <h3>App behaviour</h3>
          </div>
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
          <p className="behavior-hint">
            Automatic updates are unavailable in unsigned beta builds. Download updates manually
            from GitHub Releases.
          </p>
        </section>

        <section className="section">
          <div className="section-heading">
            <h3>Support &amp; data</h3>
          </div>
          <p className="support-copy">
            Diagnostics are stored locally, bounded in size, and redact network addresses, file
            paths, identifiers and track metadata by default. Nothing is uploaded.
          </p>
          <div className="button-row">
            <button className="btn btn-secondary" onClick={onCopy}>
              <Icon name="copy" /> Copy diagnostics
            </button>
            {confirmForget && (
              <button className="btn btn-secondary" onClick={() => setConfirmForget(false)}>
                Cancel
              </button>
            )}
            <button className="btn btn-danger" disabled={forgetting} onClick={forget}>
              {forgetting
                ? 'Forgetting…'
                : confirmForget
                  ? 'Confirm forget Roon'
                  : 'Forget Roon authorization'}
            </button>
            <button className="btn btn-ghost" onClick={onBackToSetup}>
              Run setup again
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}

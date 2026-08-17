import { useState } from 'react';
import type { AppSettingsPatch } from '../../shared/contracts';
import { Icon } from './Icon';
import { RoonConnectionChooser } from './RoonConnectionChooser';
import { StatusRow } from './StatusRow';
import { Toggle } from './Toggle';
import { ZoneChooser } from './ZoneChooser';
import { STATUS_DOT, STATUS_LABEL } from '../labels';
import type { UiSnapshot } from '../snapshot';

export function Setup({
  snapshot,
  onDone,
  update
}: {
  snapshot: UiSnapshot;
  onDone: () => Promise<void>;
  update: (patch: AppSettingsPatch) => void;
}) {
  const [finishing, setFinishing] = useState(false);
  const canFinish =
    snapshot.settings.zoneMode === 'automatic' || Boolean(snapshot.settings.selectedZoneId);

  return (
    <main className="setup-shell">
      <header>
        <span className="kicker">Welcome</span>
        <h1>Set up Roon Presence</h1>
        <p>Runs locally, stays quiet in your tray, and never needs your Discord password.</p>
      </header>

      <section className="setup-step">
        <div className="section-heading">
          <h2>Connect Roon</h2>
          <StatusRow
            label="Roon"
            dotClass={STATUS_DOT[snapshot.roon.status]}
            statusLabel={STATUS_LABEL[snapshot.roon.status]}
          />
        </div>
        <p className="step-hint">
          {snapshot.roon.status === 'waiting'
            ? 'Open Roon Settings → Extensions, find Roon Presence, and click Enable.'
            : snapshot.roon.message || 'Searching your network for a Roon Server…'}
        </p>
        <RoonConnectionChooser snapshot={snapshot} update={update} />
      </section>

      <section className="setup-step">
        <h2>Choose a zone</h2>
        <p className="step-hint">
          Pick one zone, or let automatic mode follow whichever zone is playing.
        </p>
        <ZoneChooser snapshot={snapshot} update={update} />
      </section>

      <section className="setup-step">
        <div className="section-heading">
          <h2>Discord</h2>
          <StatusRow
            label="Discord"
            dotClass={snapshot.discord.status}
            statusLabel={STATUS_LABEL[snapshot.discord.status]}
          />
        </div>
        <p className="step-hint">
          No login or bot token required. Discord must be running on this computer.
        </p>
      </section>

      <section className="setup-step consent-card">
        <div className="consent-heading">
          <span className="consent-icon">
            <Icon name="shield" />
          </span>
          <span>
            <strong>Album artwork</strong>
            <small>Only artist and album text is sent to MusicBrainz. Nothing else leaves this computer.</small>
          </span>
        </div>
        <Toggle
          label="Use MusicBrainz artwork matching"
          checked={snapshot.settings.artworkLookupEnabled}
          onChange={(artworkLookupEnabled) => update({ artworkLookupEnabled })}
        />
      </section>

      <div className="setup-actions">
        <button
          className="button primary"
          disabled={!canFinish || finishing}
          onClick={() => {
            setFinishing(true);
            void onDone()
              .catch(() => undefined)
              .finally(() => setFinishing(false));
          }}
        >
          {finishing ? 'Finishing…' : 'Open dashboard'}
        </button>
      </div>
    </main>
  );
}

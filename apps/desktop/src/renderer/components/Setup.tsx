import { useState } from 'react';
import type { AppSettingsPatch } from '../../shared/contracts';
import { RoonConnectionChooser } from './RoonConnectionChooser';
import { Toggle } from './Toggle';
import { ZoneChooser } from './ZoneChooser';
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
    <main className="setup">
      <span className="setup-kicker">First movement</span>
      <h1>Set up Roon Presence</h1>
      <p className="setup-intro">
        Roon Presence runs entirely on this computer. It listens to your Roon Server over the
        local network and hands a single line of text to the Discord client already running
        beside it. No account, no server of ours, no listening history kept anywhere.
      </p>
      <div className="hr" />

      <section className="setup-movement">
        <span className="setup-numeral">I</span>
        <div>
          <h2>Connect Roon</h2>
          <p>
            Open Roon → Settings → Extensions, find <em>Roon Presence</em>, and press Enable.
            Discovery keeps retrying in the background.
          </p>
          <span className="field-label">Connection method</span>
          <RoonConnectionChooser snapshot={snapshot} update={update} />
        </div>
      </section>

      <section className="setup-movement">
        <span className="setup-numeral">II</span>
        <div>
          <h2>Choose a zone</h2>
          <p>Pick one room, or let automatic mode follow whichever zone is playing.</p>
          <ZoneChooser snapshot={snapshot} update={update} />
        </div>
      </section>

      <section className="setup-movement">
        <span className="setup-numeral">III</span>
        <div>
          <h2>
            Album artwork <span className="tag tag-outline">Opt-in</span>
          </h2>
          <p>
            Turn this on and the current artist and album text are sent to MusicBrainz to find a
            public cover. Nothing else leaves this computer, and Discord only receives the
            resulting Cover Art Archive link.
          </p>
          <Toggle
            label="Use MusicBrainz artwork matching"
            checked={snapshot.settings.artworkLookupEnabled}
            onChange={(artworkLookupEnabled) => update({ artworkLookupEnabled })}
          />
        </div>
      </section>

      <div className="setup-footer">
        <p>Discord must be running on this computer. No login or bot token is required.</p>
        <button
          className="btn btn-primary"
          disabled={!canFinish || finishing}
          onClick={() => {
            setFinishing(true);
            void onDone()
              .catch(() => undefined)
              .finally(() => setFinishing(false));
          }}
        >
          {finishing ? 'Finishing…' : 'Open the dashboard'}
        </button>
      </div>
    </main>
  );
}

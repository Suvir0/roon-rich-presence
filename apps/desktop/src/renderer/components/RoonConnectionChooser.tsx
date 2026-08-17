import { useEffect, useRef, useState } from 'react';
import type { AppSettingsPatch } from '../../shared/contracts';
import { RECOVERY_COPY } from '../labels';
import type { UiSnapshot } from '../snapshot';

export function RoonConnectionChooser({
  snapshot,
  update
}: {
  snapshot: UiSnapshot;
  update: (patch: AppSettingsPatch) => void;
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
  const recovery = snapshot.roon.reason ? RECOVERY_COPY[snapshot.roon.reason] : undefined;

  return (
    <div>
      {recovery && (
        <div className="recovery-banner" role="alert">
          <span className="recovery-copy">
            <strong>{recovery.title}</strong>
            <small>{recovery.body}</small>
          </span>
          {snapshot.roon.reason === 'local-network-blocked' && (
            <button
              className="btn btn-secondary"
              onClick={() => void window.rrp?.openLocalNetworkSettings()}
            >
              Open settings
            </button>
          )}
        </div>
      )}
      <div className="connection-row">
        <div className="seg" role="group" aria-label="Roon connection method">
          <label className="seg-opt">
            <input type="radio" name="rrp-conn" checked={!manual} onChange={selectAutomatic} />
            Automatic discovery
          </label>
          <label className="seg-opt">
            <input type="radio" name="rrp-conn" checked={manual} onChange={() => setManual(true)} />
            Manual address
          </label>
        </div>
        <p>
          {manual
            ? 'Use this when automatic discovery is blocked by your network.'
            : 'Recommended. Finds the server and its current API port automatically.'}
        </p>
      </div>
      {manual && (
        <>
          <div className="manual-row">
            <div className="field">
              <label htmlFor="rrp-host">Server host</label>
              <input
                id="rrp-host"
                className="input"
                placeholder="192.168.1.20"
                value={host}
                onChange={(event) => {
                  editing.current = true;
                  setHost(event.target.value);
                }}
              />
            </div>
            <div className="field">
              <label htmlFor="rrp-port">API port — optional</label>
              <input
                id="rrp-port"
                className="input"
                inputMode="numeric"
                placeholder="Auto"
                value={port}
                onChange={(event) => {
                  editing.current = true;
                  setPort(event.target.value);
                }}
              />
            </div>
            <button className="btn btn-primary" onClick={saveManual}>
              Save and connect
            </button>
          </div>
          {formError && <p className="field-error">{formError}</p>}
        </>
      )}
    </div>
  );
}

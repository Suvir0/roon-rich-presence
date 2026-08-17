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
        <p>Recommended. Finds the server and its current API port automatically.</p>
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
              Save and connect
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

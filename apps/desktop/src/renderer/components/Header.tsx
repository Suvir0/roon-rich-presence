import { Icon } from './Icon';
import { StatusRow } from './StatusRow';
import { STATUS_DOT, STATUS_LABEL } from '../labels';
import type { UiSnapshot } from '../snapshot';

export function Header({
  snapshot,
  onTogglePresence,
  onToggleTheme
}: {
  snapshot: UiSnapshot;
  onTogglePresence: () => void;
  onToggleTheme: () => void;
}) {
  const dark = snapshot.settings.theme === 'dark';
  return (
    <header className="topbar">
      <span className="brand">
        <Icon name="wave" />
        <strong>Roon Presence</strong>
        {snapshot.version && <span className="brand-edition">No.&nbsp;{snapshot.version}</span>}
      </span>
      <span className="status-pair">
        <StatusRow
          label="Roon"
          dotClass={STATUS_DOT[snapshot.roon.status]}
          statusLabel={STATUS_LABEL[snapshot.roon.status]}
        />
        <StatusRow
          label="Discord"
          dotClass={STATUS_DOT[snapshot.discord.status]}
          statusLabel={STATUS_LABEL[snapshot.discord.status]}
        />
      </span>
      <button
        className="btn btn-icon theme-toggle"
        aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
        onClick={onToggleTheme}
      >
        <Icon name={dark ? 'sun' : 'moon'} />
      </button>
      <button
        className="btn btn-primary"
        aria-pressed={snapshot.settings.presenceEnabled}
        onClick={onTogglePresence}
      >
        {snapshot.settings.presenceEnabled ? 'Presence on' : 'Presence off'}
      </button>
    </header>
  );
}

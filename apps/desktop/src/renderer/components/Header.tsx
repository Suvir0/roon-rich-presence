import { Icon, type IconName } from './Icon';
import { StatusRow } from './StatusRow';
import { STATUS_DOT, STATUS_LABEL } from '../labels';
import type { UiSnapshot } from '../snapshot';
import { nextThemeMode, THEME_LABEL } from '../theme';
import type { ThemeMode } from '../../shared/contracts';

const THEME_ICON: Record<ThemeMode, IconName> = {
  light: 'sun',
  dark: 'moon',
  system: 'display'
};

export function Header({
  snapshot,
  onTogglePresence,
  onCycleTheme
}: {
  snapshot: UiSnapshot;
  onTogglePresence: () => void;
  onCycleTheme: () => void;
}) {
  const { theme } = snapshot.settings;
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
        aria-label={`Theme: ${THEME_LABEL[theme]}. Switch to ${THEME_LABEL[
          nextThemeMode(theme)
        ].toLowerCase()}.`}
        title={`Theme: ${THEME_LABEL[theme]}`}
        onClick={onCycleTheme}
      >
        <Icon name={THEME_ICON[theme]} />
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

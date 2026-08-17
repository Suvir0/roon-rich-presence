import type { AppSettingsPatch } from '../../shared/contracts';
import type { UiSnapshot } from '../snapshot';

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function ZoneChooser({
  snapshot,
  update
}: {
  snapshot: UiSnapshot;
  update: (patch: AppSettingsPatch) => void;
}) {
  return (
    <div className="zone-chooser" role="radiogroup" aria-label="Playback zone">
      <button
        role="radio"
        aria-checked={snapshot.settings.zoneMode === 'automatic'}
        className={snapshot.settings.zoneMode === 'automatic' ? 'selected' : ''}
        onClick={() => update({ zoneMode: 'automatic' })}
      >
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
          <span>
            <strong>{zone.name}</strong>
            <small>{zone.state ? capitalize(zone.state) : 'Available'}</small>
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

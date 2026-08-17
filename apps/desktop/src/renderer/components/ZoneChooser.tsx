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
    <div className="zone-list" role="radiogroup" aria-label="Playback zone">
      <label className="radio">
        <input
          type="radio"
          name="rrp-zone"
          checked={snapshot.settings.zoneMode === 'automatic'}
          onChange={() => update({ zoneMode: 'automatic' })}
        />
        <span className="dot" aria-hidden="true" />
        <span className="radio-copy">
          <strong>Automatic</strong>
          <small>Follow the active zone</small>
        </span>
      </label>
      {snapshot.zones.map((zone) => {
        const checked = snapshot.settings.zoneMode === 'selected' && snapshot.settings.selectedZoneId === zone.id;
        return (
          <label className="radio" key={zone.id}>
            <input
              type="radio"
              name="rrp-zone"
              checked={checked}
              onChange={() => update({ zoneMode: 'selected', selectedZoneId: zone.id })}
            />
            <span className="dot" aria-hidden="true" />
            <span className="radio-copy">
              <strong>{zone.name}</strong>
              <small>{zone.state ? capitalize(zone.state) : 'Available'}</small>
            </span>
          </label>
        );
      })}
      {!snapshot.zones.length && (
        <p className="empty-inline">
          Zones appear here once Roon is connected. Automatic mode is available now.
        </p>
      )}
    </div>
  );
}

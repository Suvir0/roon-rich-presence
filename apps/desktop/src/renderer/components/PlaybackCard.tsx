import { Artwork } from './Artwork';
import { formatTime } from '../labels';
import type { UiSnapshot } from '../snapshot';

const DELIVERY_NOTE: Record<string, string> = {
  live: 'This is the activity currently sent to Discord.',
  waiting: 'Open Discord on this computer to publish this activity.',
  error: 'Discord could not receive the activity. Reopen Discord and try again.',
  disabled: 'Sharing is turned off.',
  paused: 'A timestamp-free paused activity is being shared.',
  idle: 'Nothing is being sent to Discord.'
};

function delivery(snapshot: UiSnapshot): { label: string; kind: keyof typeof DELIVERY_NOTE } {
  if (!snapshot.settings.presenceEnabled) return { label: 'Disabled', kind: 'disabled' };
  if (snapshot.discord.status !== 'connected') {
    return snapshot.discord.status === 'error'
      ? { label: 'Discord error', kind: 'error' }
      : { label: 'Waiting for Discord', kind: 'waiting' };
  }
  if (!snapshot.presence) return { label: 'Idle', kind: 'idle' };
  return snapshot.presence.paused ? { label: 'Paused', kind: 'paused' } : { label: 'Published', kind: 'live' };
}

export function PlaybackCard({ snapshot }: { snapshot: UiSnapshot }) {
  const playback = snapshot.playback;
  const presence = snapshot.presence;
  const position = playback?.positionSeconds ?? 0;
  const duration = playback?.durationSeconds ?? 0;
  const progress = duration > 0 ? Math.min(100, Math.max(0, (position / duration) * 100)) : 0;
  const state = delivery(snapshot);

  return (
    <section className="card playback-card" aria-labelledby="playback-heading">
      <div className="eyebrow-row">
        <h2 id="playback-heading">Now playing</h2>
        <span className={`live-pill ${state.kind}`}>
          <span aria-hidden="true" /> {state.label}
        </span>
      </div>
      <div className="track-layout">
        <Artwork snapshot={snapshot} />
        <div className="track-copy">
          <strong>{playback?.track ?? 'Waiting for music'}</strong>
          <span>{playback?.artist ?? 'Start playback in Roon to see it here.'}</span>
          <small>{playback?.zoneName ?? 'No active zone'}</small>
        </div>
      </div>
      <div
        className="progress"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress)}
        aria-label={
          duration > 0 ? `${Math.round(progress)} percent played` : 'Playback progress unavailable'
        }
      >
        <div>
          <span style={{ width: `${progress}%` }} />
        </div>
        <small>{formatTime(position)}</small>
        <small>{formatTime(duration)}</small>
      </div>
      <p className="delivery-note">
        <strong>{presence?.details ?? 'No activity published'}</strong>
        {presence?.state ? ` — ${presence.state}` : ''}
        <br />
        {DELIVERY_NOTE[state.kind]}
      </p>
    </section>
  );
}

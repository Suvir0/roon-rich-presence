import { Artwork } from './Artwork';
import { DELIVERY_NOTE, formatTime } from '../labels';
import type { UiSnapshot } from '../snapshot';

function delivery(snapshot: UiSnapshot): { label: string; kind: keyof typeof DELIVERY_NOTE } {
  if (!snapshot.settings.presenceEnabled) return { label: 'Disabled', kind: 'disabled' };
  if (snapshot.discord.status !== 'connected') {
    return snapshot.discord.status === 'error'
      ? { label: 'Discord error', kind: 'error' }
      : { label: 'Waiting for Discord', kind: 'waiting' };
  }
  if (!snapshot.presence) return { label: 'Idle', kind: 'idle' };
  return snapshot.presence.paused
    ? { label: 'Paused', kind: 'paused' }
    : { label: 'Published', kind: 'live' };
}

export function NowPlaying({ snapshot }: { snapshot: UiSnapshot }) {
  const playback = snapshot.playback;
  const presence = snapshot.presence;
  const position = playback?.positionSeconds ?? 0;
  const duration = playback?.durationSeconds ?? 0;
  const progress = duration > 0 ? Math.min(100, Math.max(0, (position / duration) * 100)) : 0;
  const state = delivery(snapshot);

  return (
    <aside className="now-playing">
      <div className="now-playing-header">
        <span>Now playing</span>
        <span className={`tag ${state.kind === 'live' ? 'tag-accent' : 'tag-neutral'}`}>
          {state.label}
        </span>
      </div>

      <Artwork snapshot={snapshot} />

      <div>
        <h2 className="track-title">{playback?.track ?? 'Waiting for music'}</h2>
        <p className="track-artist">
          {playback?.artist ?? 'Start playback in Roon to see it here.'}
        </p>
        <p className="track-album">{playback?.zoneName ?? 'No active zone'}</p>
      </div>

      <div>
        <div
          className="progress-rail"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress)}
          aria-label={
            duration > 0
              ? `${Math.round(progress)} percent played`
              : 'Playback progress unavailable'
          }
        >
          <span style={{ width: `${progress}%` }} />
        </div>
        <div className="progress-meta">
          <span>{formatTime(position)}</span>
          <span className="zone">{playback?.zoneName ?? ''}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      <div className="published-block">
        <span className="published-label">Published to Discord</span>
        <p className="published-details">
          <strong>{presence?.details ?? 'No activity published'}</strong>
        </p>
        {presence?.state && <p className="published-state">{presence.state}</p>}
        <p className="published-note">{DELIVERY_NOTE[state.kind]}</p>
      </div>
    </aside>
  );
}

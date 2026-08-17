import { useState } from 'react';
import { Icon } from './Icon';
import type { UiSnapshot } from '../snapshot';

export function Artwork({ snapshot }: { snapshot: UiSnapshot }) {
  const title = snapshot.playback?.track ?? 'Nothing playing';
  const artworkUrl = snapshot.playback?.artworkUrl;
  const [brokenUrl, setBrokenUrl] = useState<string>();
  const broken = Boolean(artworkUrl && artworkUrl === brokenUrl);
  return (
    <div className="plate cover-frame">
      {artworkUrl && !broken ? (
        <img src={artworkUrl} alt={`Cover art for ${title}`} onError={() => setBrokenUrl(artworkUrl)} />
      ) : (
        <div className="plate-placeholder">
          <Icon name="wave" />
        </div>
      )}
      {snapshot.playback?.state === 'playing' && (
        <span className="playing-bars" aria-label="Playing">
          <i />
          <i />
          <i />
        </span>
      )}
    </div>
  );
}

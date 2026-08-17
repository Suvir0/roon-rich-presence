import { useEffect, useRef, useState } from 'react';
import type { AppSettingsPatch } from '../shared/contracts';
import { Icon } from './components/Icon';
import { PlaybackCard } from './components/PlaybackCard';
import { Preferences } from './components/Preferences';
import { Setup } from './components/Setup';
import { StatusRow } from './components/StatusRow';
import { useToast } from './hooks/useToast';
import { STATUS_DOT, STATUS_LABEL } from './labels';
import { EMPTY_SNAPSHOT, toUiSnapshot, type UiSnapshot } from './snapshot';

export default function App() {
  const api = window.rrp;
  const [snapshot, setSnapshot] = useState<UiSnapshot>(EMPTY_SNAPSHOT);
  const snapshotRef = useRef(snapshot);
  const [loaded, setLoaded] = useState(() => !api);
  const [toast, showToast] = useToast();
  const updateSequence = useRef(0);

  useEffect(() => {
    let active = true;
    api
      ?.getSnapshot()
      .then((value) => {
        if (!active) return;
        const next = toUiSnapshot(value);
        snapshotRef.current = next;
        setSnapshot(next);
        setLoaded(true);
      })
      .catch(() => {
        if (active) setLoaded(true);
      });
    const unsubscribe = api?.subscribe((value) => {
      if (!active) return;
      const next = toUiSnapshot(value);
      snapshotRef.current = next;
      setSnapshot(next);
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [api]);

  const update = (patch: AppSettingsPatch) => {
    const sequence = ++updateSequence.current;
    const previous = snapshotRef.current;
    const optimistic: UiSnapshot = {
      ...previous,
      settings: {
        ...previous.settings,
        ...patch,
        manualRoonPort:
          'manualRoonPort' in patch
            ? (patch.manualRoonPort ?? undefined)
            : previous.settings.manualRoonPort
      }
    };
    snapshotRef.current = optimistic;
    setSnapshot(optimistic);
    Promise.resolve(api?.updateSettings(patch))
      .then((value) => {
        if (!value || sequence !== updateSequence.current) return;
        const next = toUiSnapshot(value);
        snapshotRef.current = next;
        setSnapshot(next);
      })
      .catch(() => {
        if (sequence !== updateSequence.current) return;
        snapshotRef.current = previous;
        setSnapshot(previous);
        showToast('That setting could not be saved. Your previous choice was restored.');
      });
  };

  const action = async (task: (() => Promise<unknown> | unknown) | undefined, success: string) => {
    try {
      await task?.();
      showToast(success);
    } catch {
      showToast('Something went wrong. Please try again.');
    }
  };

  const complete = async () => {
    try {
      const value = await api?.completeOnboarding();
      const next = value ? toUiSnapshot(value) : { ...snapshotRef.current, onboardingComplete: true };
      snapshotRef.current = next;
      setSnapshot(next);
      showToast('Setup complete');
    } catch {
      showToast('Setup could not be completed. Please try again.');
      throw new Error('Onboarding completion failed');
    }
  };

  const forgetRoon = async () => {
    try {
      await api?.forgetRoon();
      showToast('Roon authorization removed');
    } catch (error) {
      showToast('Roon authorization could not be removed. Please try again.');
      throw error;
    }
  };

  const healthy = snapshot.roon.status === 'connected' && snapshot.discord.status === 'connected';

  if (!loaded) {
    return (
      <main className="loading">
        <div className="logo">
          <Icon name="wave" />
          <strong>Roon Presence</strong>
        </div>
        <div className="loader" />
        <span>Starting securely…</span>
      </main>
    );
  }

  if (!snapshot.onboardingComplete) {
    return (
      <>
        <Setup snapshot={snapshot} onDone={complete} update={update} />
        {toast && (
          <div className="toast" role="status">
            {toast}
          </div>
        )}
      </>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="logo">
          <Icon name="wave" />
          <strong>Roon Presence</strong>
        </div>
        <button
          className={`power ${snapshot.settings.presenceEnabled ? 'on' : ''}`}
          aria-label={snapshot.settings.presenceEnabled ? 'Disable presence' : 'Enable presence'}
          onClick={() => update({ presenceEnabled: !snapshot.settings.presenceEnabled })}
        >
          <span>●</span>
          {snapshot.settings.presenceEnabled ? 'Presence on' : 'Presence off'}
        </button>
      </header>

      <div className={`health ${healthy ? 'good' : ''}`}>
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
      </div>

      <main className="content">
        <PlaybackCard snapshot={snapshot} />
        <Preferences
          snapshot={snapshot}
          update={update}
          onForget={forgetRoon}
          onCopy={() => action(api?.copyDiagnostics?.bind(api), 'Redacted diagnostics copied')}
          onExternal={(url) => action(() => api?.openExternal(url), 'Opened in your browser')}
        />
      </main>

      {snapshot.version && (
        <footer className="version">Local-first · No telemetry · v{snapshot.version}</footer>
      )}

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

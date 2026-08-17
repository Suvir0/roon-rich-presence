import { useEffect, useRef, useState } from 'react';
import type { AppSettingsPatch } from '../shared/contracts';
import { Dashboard } from './components/Dashboard';
import { Header } from './components/Header';
import { Icon } from './components/Icon';
import { Setup } from './components/Setup';
import { useToast } from './hooks/useToast';
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

  useEffect(() => {
    document.documentElement.dataset.theme = snapshot.settings.theme;
  }, [snapshot.settings.theme]);

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

  if (!loaded) {
    return (
      <div className="app-frame">
        <main className="loading">
          <div className="brand">
            <Icon name="wave" />
            <strong>Roon Presence</strong>
          </div>
          <div className="loader" />
          <span>Starting securely…</span>
        </main>
      </div>
    );
  }

  return (
    <div className="app-frame">
      <div className="app-card">
        <Header
          snapshot={snapshot}
          onTogglePresence={() => update({ presenceEnabled: !snapshot.settings.presenceEnabled })}
          onToggleTheme={() => update({ theme: snapshot.settings.theme === 'dark' ? 'light' : 'dark' })}
        />

        {!snapshot.onboardingComplete ? (
          <Setup snapshot={snapshot} onDone={complete} update={update} />
        ) : (
          <Dashboard
            snapshot={snapshot}
            update={update}
            onForget={forgetRoon}
            onCopy={() => action(api?.copyDiagnostics?.bind(api), 'Redacted diagnostics copied')}
            onExternal={(url) => action(() => api?.openExternal(url), 'Opened in your browser')}
            onBackToSetup={() => update({ onboardingComplete: false })}
          />
        )}

        <footer className="app-footer">
          <span>Local-first</span>
          <span className="dot-sep">·</span>
          <span>No telemetry</span>
          {snapshot.version && (
            <>
              <span className="dot-sep">·</span>
              <span className="version">v{snapshot.version}</span>
            </>
          )}
        </footer>
      </div>

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

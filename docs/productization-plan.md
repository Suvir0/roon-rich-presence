# Productization plan

This plan turns the existing local-first Electron companion into a release-quality desktop utility. macOS is the stable target; Windows and Linux remain beta until their platform gates pass.

## Product direction

Roon Rich Presence should feel like a quiet hi-fi utility: native system typography, restrained graphite surfaces, one warm accent, accurate connection language, and a menu-bar workflow that handles common actions without opening the full window.

The app window is for onboarding, playback detail, and preferences. The tray/menu-bar surface is for current status, presence on/off, zone selection, opening the dashboard, and quitting.

## Workstreams and subagent ownership

### 1. Security and privacy

- Quarantine and ignore legacy Roon authorization files; revoke any exposed authorization.
- Bound and redact diagnostics, serialize log rotation, and protect stored files.
- Test IPC sender validation, custom-protocol containment, permission scoping, malformed URLs, and oversized LAN/native-bridge input.
- Minimize macOS entitlements and verify every bundled native binary.
- Add clear-cache/logs/all-local-data controls and document retention.

Release gate: no secrets or private playback/network data in the tree, logs, diagnostics, installers, or build output; adversarial boundary tests pass.

### 2. UI, onboarding, and accessibility

- Replace marketing-heavy dashboard copy and repeated cards with a compact playback/status hierarchy.
- Render the exact `AppSnapshot.presence`; never claim an activity is published while Discord is unavailable.
- Roll back optimistic settings/onboarding state after persistence failure.
- Use native title-bar behavior, truthful connection repair states, accessible radio/progress/navigation semantics, readable type, and reduced motion.
- Verify playing, paused, stopped, disconnected, secure-storage-warning, long-metadata, and 200% zoom states.

Release gate: keyboard and VoiceOver flows work, UI claims match controller state, and screenshot review passes for all primary states.

### 3. Menu bar and platform shell

- Use a simple optical template icon that remains legible at 16/32 px.
- Open the native quick-action menu on primary click.
- Include playback header, presence checkbox, automatic/selected-zone radio submenu, Roon/Discord status, dashboard, and quit.
- Avoid rebuilding an open menu for progress-only updates.
- Add platform-specific application/tray assets and validate startup behavior on every supported OS.

Release gate: common controls are available in one click and work with keyboard/VoiceOver; light/dark menu bars and Retina/non-Retina displays are verified.

### 4. Reliability and QA

- Cover settings corruption/migration, bridge crash/restart, sleep/wake, permission denial, updater failure, and quit-time presence clearing.
- Bound Roon zone/string collections and cache reads; validate cached external artwork URLs.
- Add packaged Electron launch/smoke tests and clean-machine install/update/uninstall checks.
- Run the native protocol suite and production Discord bridge preflight on macOS, Windows, and Linux.

Release gate: all automated suites pass from a clean clone and the completed manual matrix is attached to the release candidate.

### 5. Packaging and release engineering

- Provide root format/lint/typecheck/test/build/audit scripts and real macOS universal, Windows x64, and Linux x64 package commands.
- Accept only an exact `vX.Y.Z` release tag whose version matches every package.
- Preserve native bridge executable permissions, reject stub mode, and stage only explicit public artifacts.
- Pin workflow actions, generate checksums/SBOM/license notices/provenance, and never overwrite a published release.
- Freeze the production application identity, repository owner, Discord application/assets, publisher, support address, signing identities, and update feed.

Release gate: final downloaded files match checksums and attestations; macOS passes recursive signing, Gatekeeper, notarization, stapling, universal-slice, and update tests; Windows/Linux beta exceptions are explicit.

## Release sequence

1. Internal alpha: clean clone, full automated suite, production bridge preflight, and unsigned local packages.
2. Signed macOS release candidate: Apple Silicon and Intel clean-machine acceptance plus update-from-previous-version.
3. Windows/Linux beta candidates: signed installer/package checks and platform-specific Discord IPC/startup validation.
4. Public release: publish immutable assets only after the release captain records evidence for every applicable gate.

Existing `release/` artifacts are not release candidates until rebuilt and verified; prior local macOS bundles failed strict nested signature verification during the productization audit.

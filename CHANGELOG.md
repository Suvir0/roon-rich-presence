# Changelog

This project follows semantic versioning. Dates use the ISO 8601 format.

## 0.2.0 - 2026-08-17

- Replaced the entire interface with a new "Classical" design: a light cream/gold serif layout with a document-style card, roman-numeral onboarding, and a two-column now-playing/settings dashboard
- Added a light/dark theme toggle, persisted per user
- Vendored the interface's Cormorant Garamond and Lora fonts locally instead of loading them from Google Fonts, so the app never phones out on launch
- Reduced installed app size (~530 MB to ~306 MB per architecture) and packaged asar size (17 MB to ~5.2 MB) by dropping the `zod` dependency for a hand-rolled settings validator, moving `react`/`react-dom` to build-time-only dependencies, and excluding the `@rrp/core` workspace package's source and test files from the packaged app
- Reduced download size by splitting macOS packaging into separate arm64 and x64 builds instead of one universal binary

## 0.1.3 - 2026-08-16

- Fixed album artwork matching when Roon appends common edition labels such as **Explicit**, **Clean**, **Deluxe Edition**, or remaster annotations
- Invalidated earlier negative artwork-cache entries so corrected matches are retried immediately
- Added rate-limit-safe delays between MusicBrainz and Cover Art Archive retries
- Added automatic retries for transient artwork-service failures while the same song remains selected
- Added redacted artwork failure diagnostics without recording artist, album, or track metadata

## 0.1.2 - 2026-08-16

- Changed Roon endpoint discovery to use the API port advertised by the server
- Changed manual connection to accept a server host with an optional exact port and to connect only after **Save and Connect** is pressed; host-only connections try directed discovery before a bounded local API-port fallback
- Added clearer discovery and reconnecting guidance, including a best-effort Local Network hint after repeated same-subnet route failures
- Added a best-effort macOS Local Network permission prompt before discovery
- Documented that unsigned, ad-hoc-signed macOS builds cannot guarantee reliable Local Network privacy tracking across updates

## 0.1.1

Initial release candidate.

- Added Roon discovery, authorization, zone selection, and playback subscriptions
- Added Discord Rich Presence through the native Social SDK bridge
- Added opt-in MusicBrainz and Cover Art Archive matching
- Added onboarding, a desktop dashboard, settings, and menu bar controls
- Added secure local settings, redacted diagnostics, update checks, and hardened packaging
- Added macOS universal, Windows x64 beta, and Linux x64 beta release workflows

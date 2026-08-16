# Changelog

This project follows semantic versioning. Dates use the ISO 8601 format.

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

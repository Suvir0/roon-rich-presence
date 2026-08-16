# Manual release test matrix

Record app version, commit, SDK version/checksum, OS/build, architecture, Roon Server version, Discord channel/version, tester, date, and outcome for every run. Attach redacted diagnostics only; never attach authorization state or unredacted listening metadata.

| Area                | Scenario                                                         | Expected result                                                                                                                         |
| ------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Install             | Fresh install, launch, and uninstall                             | Beta label is visible; documented platform warning is expected; uninstall leaves no running process                                     |
| macOS Local Network | Inspect `Info.plist` for `NSLocalNetworkUsageDescription`        | Key is present in packaged `Roon Rich Presence.app/Contents/Info.plist`                                                                 |
| macOS Local Network | First launch of packaged app with no prior Local Network grant   | macOS prompts "Roon Rich Presence wants to find devices on your local network"; allowing triggers discovery                             |
| macOS Local Network | Deny Local Network, then re-open                                 | Extension does not appear in Roon; dashboard shows "Still searching…" hint mentioning Local Network after ~12 s                         |
| macOS Local Network | Allow Local Network in System Settings, then quit and reopen     | Extension appears in Roon Settings → Extensions within seconds; dashboard shows "Enable in Roon"                                        |
| Onboarding          | Discover Server and enable extension                             | Status shows "Searching…" while scanning; transitions to "Enable in Roon" once server is found; transitions to "Connected" after Enable |
| Onboarding          | Onboarding step 2 with server already found but not yet enabled  | Title reads "Roon Server found — almost there." and body prompts user to Enable in Extensions                                           |
| Discovery fallback  | Block UDP and enter host/port                                    | Manual connection succeeds with validation and a useful failure state                                                                   |
| Reconnect           | Restart app, Roon Server, then network                           | Authorization persists securely and reconnects with capped backoff                                                                      |
| Playback            | Play a normal track                                              | Track, artist, album, active zone, cover/fallback, and progress are correct                                                             |
| Playback variants   | Radio, podcast, stream, and missing metadata                     | Presence remains readable; absent fields never render as `undefined` or stale data                                                      |
| Timeline            | Seek, pause, resume, stop, and transition                        | Timestamps reset after seek; default pause/stop clears; no update-rate violation                                                        |
| Loading             | Introduce a transient load under/over 10 seconds                 | Previous card is retained at most 10 seconds and then clears                                                                            |
| Zones               | Multiple/grouped zones in selected mode                          | Only selected zone controls presence                                                                                                    |
| Zones               | Automatic mode with simultaneous playback                        | Active zone remains sticky until it stops/disappears; no flapping                                                                       |
| Discord lifecycle   | Start Discord after app; restart Discord mid-track               | Desired activity is restored without restarting the app                                                                                 |
| Discord clients     | Stable, PTB, and Canary                                          | Supported clients show equivalent activity or a documented limitation                                                                   |
| Observer            | View profile from a second account                               | Listening type, text, images, tooltips, and timestamps match preview                                                                    |
| Artwork opt-in      | Enable, match, miss, rate-limit, and go offline                  | Disclosure precedes request; exact high-confidence match only; fallback is reliable                                                     |
| Privacy             | Inspect outbound traffic with artwork disabled/enabled           | Disabled makes no artwork requests; enabled sends artist/album only to allowlisted HTTPS hosts                                          |
| Sleep/wake          | Sleep during playback, then wake                                 | Roon/Discord reconnect and progress timestamps are recalculated                                                                         |
| Tray                | Toggle presence, open app, close window, quit                    | Close hides; toggle clears/restores; Quit clears presence and exits                                                                     |
| Autostart           | Enable start-at-login and launch-hidden                          | Exactly one hidden instance starts and tray remains accessible                                                                          |
| Diagnostics         | Copy redacted diagnostics                                        | Credentials, IDs designated private, paths, and playback metadata are redacted                                                          |
| Update              | Upgrade from previous stable version                             | Settings migrate, authorization survives, signed update succeeds, presence resumes                                                      |
| Bridge safety       | Send malformed, duplicate, nested, unknown, and >16 KiB commands | Bridge rejects input, remains alive, and emits one bounded error event                                                                  |
| Failure safety      | Kill bridge repeatedly                                           | Restart policy caps attempts; UI reports failure; renderer cannot spawn arbitrary processes                                             |

## Platform release gates

- **macOS beta:** test current and previous major macOS on Apple Silicon and Intel (or a verified universal binary); validate the expected Gatekeeper warning, ad-hoc signature, hardened runtime, entitlements, DMG, ZIP, login item, and manual update procedure. Verify `NSLocalNetworkUsageDescription` is present in the packaged `Info.plist` and that the Local Network prompt appears on first launch from a clean TCC state (`tccutil reset LocalNetwork` to reset).
- **Windows beta:** test Windows 11 x64 standard user; validate NSIS install/uninstall, Start menu entry, startup registration, Discord IPC, Defender/SmartScreen behavior, and Authenticode status. Keep beta label until signed and tested without blocking warnings.
- **Linux beta:** test supported Ubuntu and one Debian-family distribution; validate AppImage executable bit, `.deb` install/remove, keyring unavailable warning, desktop entry, autostart, Discord IPC, and bundled SDK runtime resolution. Document Wayland/display-server issues.

## Final smoke before publication

On a clean machine: verify checksum and expected beta signing state, install, authorize Roon, play/seek/pause/resume/stop one track, confirm cover and profile from a second Discord account, quit and confirm presence clears, relaunch hidden, then uninstall. The production bridge must identify `discord-social-sdk`, never `stub`.

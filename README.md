# Roon Rich Presence

Roon Rich Presence is a small desktop app that shows what you are listening to in Roon on your Discord profile.

It runs on your computer, connects to Roon over your local network, and talks to the Discord desktop client through Discord's Social SDK. There is no hosted service, no account to create, and no telemetry.

This is an independent project. It is not affiliated with Roon Labs or Discord.

The product site is [rrp.suvir.net](https://rrp.suvir.net); its source lives in `website/`.

## Current status

Roon Rich Presence is a public beta.

macOS builds are published on the [GitHub Releases page](https://github.com/Suvir0/roon-rich-presence/releases) for Apple Silicon and Intel. They are ad-hoc signed so they can run, but they are not signed with an Apple Developer ID or notarized, so macOS shows a security warning on first launch.

Windows and Linux are supported in the source tree and can be built locally, but no installers are published yet. Their release builds require the Discord Social SDK secrets in the protected release workflow, which are not configured for this repository. Build them yourself with `npm run package:win` or `npm run package:linux`.

## What it does

- Finds Roon Servers on your local network
- Lets you choose a specific Roon zone or follow the active zone automatically
- Shows track, artist, album, playback progress, and optionally the zone name on Discord
- Keeps paused activity visible if you choose to enable it
- Finds public album covers through MusicBrainz and Cover Art Archive when you opt in
- Runs from the macOS menu bar or the Windows and Linux system tray
- Stores Roon authorization using the operating system's secure storage when available
- Collects no analytics or listening history

## Install

Beta downloads are attached to the [GitHub Releases page](https://github.com/Suvir0/roon-rich-presence/releases). Verify what you download against the `SHA256SUMS-mac-beta.txt` file published with the same release.

### macOS beta

1. Download `Roon Rich Presence-Beta-*-arm64.dmg` (Apple Silicon) or `-x64.dmg` (Intel) from the latest release.
2. Open the disk image and drag Roon Rich Presence into Applications.
3. In Applications, Control-click Roon Rich Presence and choose **Open**.
4. Confirm **Open** when macOS warns that the developer cannot be verified. If macOS blocks it, open **System Settings > Privacy & Security** and use **Open Anyway** for Roon Rich Presence.
5. Allow Local Network access when macOS asks. The app needs it to discover Roon.
6. Open Roon and go to **Settings > Extensions**.
7. Find **Roon Rich Presence** and click **Enable**.
8. Return to the app, choose a playback zone, and finish setup.

Only download the beta from this repository's Releases page and compare it with the published checksum. Automatic updates are disabled for unsigned beta builds, so install new versions manually from GitHub Releases.

The Local Network prompt is a best-effort mitigation in this ad-hoc-signed beta. Apple recommends a stable Apple-issued signing identity for reliable Local Network privacy tracking, so macOS may not retain or re-prompt for access across unsigned builds. If Roon discovery stops after an update, open **System Settings > Privacy & Security > Local Network**, turn on **Roon Rich Presence**, quit the app completely, and reopen it. macOS does not provide a supported `tccutil` reset for Local Network access.

If automatic discovery still cannot reach the server, enter the Roon Server host and press **Save and Connect**. A host-only connection tries directed discovery first, then a bounded fallback over local Roon API ports. If you know the exact advertised API port, enter it under **Advanced** to connect directly; this is the preferred manual option. Editing the fields alone does not start a connection.

The app stays available in the menu bar after you close its window. Click the waveform icon to change the active zone, turn Discord sharing on or off, reopen the dashboard, or quit.

### Windows beta

1. Build the x64 `.exe` installer locally with `npm run package:win`. Windows installers are not published on the Releases page yet.
2. Run the installer and choose an install location.
3. Keep the Discord desktop app running.
4. Enable Roon Rich Presence under **Roon > Settings > Extensions**.
5. Finish setup in the Roon Rich Presence window.

Windows builds should remain labeled beta until the installer is signed and the Windows test matrix is complete.

### Linux beta

Build either the x64 `.deb` package or the `.AppImage` locally with `npm run package:linux`. Linux packages are not published on the Releases page yet.

For the AppImage:

```sh
chmod +x "Roon Rich Presence-Beta-*.AppImage"
./Roon\ Rich\ Presence-Beta-*.AppImage
```

Discord Social SDK support on Linux is experimental. Desktop environment packaging and Discord IPC behavior can vary.

## Privacy

Roon discovery and playback monitoring stay on your local network. Discord receives only the activity fields you enable.

Album artwork matching is off by default. If you turn it on, the current artist and album text are sent to MusicBrainz. Discord receives the resulting public Cover Art Archive URL. Roon authorization, Discord identity, local artwork, and listening history are not uploaded by this project.

Diagnostics are stored locally, have a fixed size limit, and redact network addresses, file paths, identifiers, and credentials. Nothing is uploaded automatically.

See [SECURITY.md](SECURITY.md) for vulnerability reporting and the full security model.

## Development setup

### Requirements

- Node.js 22 or newer
- npm 10 or newer
- CMake 3.24 or newer
- A C++20 compiler
- Roon Server and a Roon client for integration testing
- Discord Desktop for production Rich Presence testing

### Install dependencies

```sh
git clone https://github.com/Suvir0/roon-rich-presence.git
cd roon-rich-presence
npm ci
```

Copy the environment template:

```sh
cp .env.example .env
```

The values in `.env.example` are public application identifiers. Never add Discord client secrets, Apple credentials, signing certificates, SDK download tokens, or Roon authorization files to `.env` or the repository.

### Build the development Discord bridge

The repository does not include Discord's proprietary Social SDK. For normal application development, build the stub bridge:

```sh
cmake -S native/discord-bridge -B native/discord-bridge/build \
  -DRRP_DISCORD_STUB=ON \
  -DRRP_BUILD_TESTS=ON \
  -DCMAKE_BUILD_TYPE=Release
cmake --build native/discord-bridge/build --config Release
ctest --test-dir native/discord-bridge/build -C Release --output-on-failure
```

Set `DISCORD_BRIDGE_PATH` in `.env` to the resulting executable. The stub checks process startup and protocol behavior, but it does not publish activity to Discord.

Production presence requires an approved Discord Social SDK archive and a production bridge build. See [native/discord-bridge/README.md](native/discord-bridge/README.md).

### Run the app

```sh
npm run dev
```

Then open Roon, go to **Settings > Extensions**, enable Roon Rich Presence, and choose a zone in the app.

### Run the checks

```sh
npm run secrets:check
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
npm run audit:prod
```

### Create local packages

```sh
npm run package:mac
npm run package:mac:beta
npm run package:win
npm run package:linux
```

Local packages are for testing. The protected GitHub Actions release workflow creates clearly labeled beta installers, checksums, an SBOM, and provenance. The macOS beta is ad-hoc signed but not Developer ID signed or notarized.

### Product site

The site served at [rrp.suvir.net](https://rrp.suvir.net) lives in `website/` and is deployed as a
Cloudflare Worker that serves static assets.

```sh
npm run site:build
npx wrangler deploy
```

`npm run site:build` writes `dist/client` (the static assets) and `dist/server/index.js` (the
Worker entry point).

The screenshots in `website/screenshots/` are captures of the real interface. Regenerate them by
starting a build with remote debugging enabled, connecting it to Roon, playing something, and
running the capture script:

```sh
"/Applications/Roon Rich Presence.app/Contents/MacOS/Roon Rich Presence" --remote-debugging-port=9222
npm run site:screenshots
```

The script captures both themes, restores the settings it found, and writes only image files.
Screenshots are published as they were captured, so review them for anything personal — zone names
and the current track appear in them — before committing.

## Maintainer release setup

### 1. Discord application

1. Create a Discord application in the Discord Developer Portal.
2. Record its numeric Application ID.
3. Upload the branded large image used as the fallback artwork.
4. Request or accept access to the Discord Social SDK and confirm its redistribution terms.
5. Obtain the SDK archive separately for each supported platform if Discord provides platform-specific downloads.
6. Calculate the SHA-256 digest independently before adding the archive to release automation.

The Discord Application ID is public. Discord client secrets and SDK download credentials are private.

### 2. GitHub repository variables

Add these under **Settings > Secrets and variables > Actions > Variables**:

| Variable                 | Value                                          |
| ------------------------ | ---------------------------------------------- |
| `DISCORD_APPLICATION_ID` | Public numeric Discord Application ID          |
| `ROON_EXTENSION_ID`      | `io.github.suvir0.roon-rich-presence`          |
| `PROJECT_CONTACT_URL`    | `https://github.com/Suvir0/roon-rich-presence` |
| `PROJECT_PUBLISHER`      | `Suvir Potdar`                                 |
| `PROJECT_SUPPORT_EMAIL`  | `hello@suvir.net`                              |

### 3. Protected GitHub environments

Create these environments under **Settings > Environments**:

- `discord-social-sdk`
- `release-signing`

Require approval before deployments to both environments. Restrict them to protected release tags when the repository plan supports deployment branch policies.

Add these secrets to `discord-social-sdk`:

| Secret                       | Purpose                                 |
| ---------------------------- | --------------------------------------- |
| `DISCORD_SDK_ARCHIVE_URL`    | HTTPS URL for the approved SDK archive  |
| `DISCORD_SDK_SHA256`         | Independently verified archive checksum |
| `DISCORD_SDK_DOWNLOAD_TOKEN` | Credential used to download the archive |

No Apple credentials are needed while macOS remains an unsigned beta. To promote macOS to a normal stable release later, join the Apple Developer Program and add:

| Secret                        | Purpose                                                                 |
| ----------------------------- | ----------------------------------------------------------------------- |
| `APPLE_ID`                    | Apple account used for notarization                                     |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password for notarization                                  |
| `APPLE_TEAM_ID`               | Apple Developer team identifier                                         |
| `CSC_LINK`                    | Base64 value or secure URL for the Developer ID Application certificate |
| `CSC_KEY_PASSWORD`            | Password for the signing certificate                                    |

Before promoting Windows out of beta, also add:

| Secret                 | Purpose                              |
| ---------------------- | ------------------------------------ |
| `WIN_CSC_LINK`         | Windows code-signing certificate     |
| `WIN_CSC_KEY_PASSWORD` | Password for the Windows certificate |

Do not place any of these secrets in source files, workflow YAML, issues, release notes, or chat logs.

### 4. Repository security settings

Enable the following where they are available:

- Private vulnerability reporting
- Secret scanning and push protection
- Dependabot alerts and security updates
- Branch protection for `main`
- Required Test and Security workflow checks
- Signed commits or signed tags for releases
- Immutable releases

### 5. Publish a release

1. Update the version in the root, desktop, core, and native project files.
2. Update release notes and third-party notices.
3. Run every local check listed above.
4. Complete [docs/manual-test-matrix.md](docs/manual-test-matrix.md).
5. Commit the release and create a signed `vX.Y.Z` tag.
6. Push the commit and tag.
7. Create an empty draft GitHub Release for that exact tag.
8. Dispatch the **Release** workflow on the tag itself with `gh workflow run release.yml --ref vX.Y.Z -f tag=vX.Y.Z`. The GitHub web form only offers a branch selector, so it cannot satisfy the workflow's tag-ref guard.
9. Download the generated artifacts and verify the expected beta signing state, checksums, SBOM, and provenance from a clean machine.
10. Publish the draft release only after the smoke tests pass.

The workflow refuses arbitrary refs, mismatched versions, stub bridges, duplicate assets, existing release assets, and placeholder project identity.

See [docs/releasing.md](docs/releasing.md) for signing details, rollback instructions, and the full release checklist.

## Project layout

```text
apps/desktop/            Electron main process, preload, React UI, and packaging
packages/core/           Presence mapping, zone selection, settings, and throttling
native/discord-bridge/   C++ bridge for the Discord Social SDK
docs/                    Release procedures and manual test plans
scripts/                 Release validation and security checks
```

## License

Roon Rich Presence is released under the [MIT License](LICENSE). Third-party software and Discord SDK files keep their own licenses. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

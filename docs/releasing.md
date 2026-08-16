# Releasing

macOS universal, Windows x64, and Linux x64 (`AppImage` and `.deb`) are beta channels. The macOS beta is ad-hoc signed so it can run, but it is not Developer ID signed or notarized. Flatpak and Snap are not produced because their sandboxes can hide Discord IPC. Linux support also depends on the Social SDK's current experimental platform support.

The macOS beta includes a best-effort Local Network permission prompt before Roon discovery begins. Because the app is ad-hoc signed, it does not have the stable Apple-issued signing identity that macOS recommends for reliable Local Network privacy tracking across builds. If discovery stops after an update, turn **Roon Rich Presence** on in **System Settings > Privacy & Security > Local Network**, quit the app completely, and reopen it. Do not recommend `tccutil`: macOS does not provide a supported command that resets Local Network privacy to its undetermined state. Use a new macOS user account or a VM restored to a pre-install snapshot to retest the first-launch prompt.

## One-time prerequisites

- Confirm the application identity, repository, publisher, support contact, and icons before the first public release. These values are currently frozen for `Suvir0/roon-rich-presence` and `io.github.suvir0.roon-rich-presence`; changing the Roon extension ID after release requires users to authorize it again.
- Add non-secret repository variables `DISCORD_APPLICATION_ID`, `ROON_EXTENSION_ID`, `PROJECT_CONTACT_URL`, `PROJECT_PUBLISHER`, and `PROJECT_SUPPORT_EMAIL`; release builds bake these public identifiers into the packaged main process.
- Create a Discord application, record its numeric Application ID, upload the branded fallback asset, accept the Social SDK terms, and confirm redistributable files for every target.
- Configure protected GitHub environments named `discord-social-sdk` and `release-signing`, each requiring reviewer approval and restricting deployment to protected tags.
- For the cloud release workflow, record `DISCORD_SDK_ARCHIVE_URL`, `DISCORD_SDK_SHA256`, and `DISCORD_SDK_DOWNLOAD_TOKEN` in `discord-social-sdk`. Use this only when Discord supplies a durable authorized download endpoint. Discord Portal browser download links expire and must not be saved as repository secrets. For the validated 1.10.18687 archive, the SHA-256 is `7041ca2c9de67ed923d2f626d1982aa397a89566da5a945e3605110a2ff9f207`.
- Apple credentials are not required for the macOS beta. Before promoting macOS to stable, add `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `CSC_LINK`, and `CSC_KEY_PASSWORD`; `CSC_LINK` contains the Developer ID Application certificate accepted by electron-builder.
- Add Windows secrets `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` before promoting Windows out of beta. Unsigned beta builds must be clearly labeled and require explicit approval.
- Enable GitHub private vulnerability reporting, secret scanning/push protection, branch protection, required test/security checks, and immutable releases where repository policy permits.

The local 0.1.1 validation used Discord Social SDK 1.10.18687 with archive SHA-256 `7041ca2c9de67ed923d2f626d1982aa397a89566da5a945e3605110a2ff9f207`. Re-verify this value independently before reusing that archive in release infrastructure.

## Local macOS beta

Discord currently provides the Social SDK through an expiring browser download instead of a reusable CI credential. Keep the downloaded ZIP outside the repository. On a Mac with Node.js 22, Xcode Command Line Tools, and CMake installed, create the complete unsigned beta with:

```sh
npm ci
npm run release:mac:local -- /absolute/path/to/DiscordSocialSdk-1.10.18687.zip
```

The command verifies the pinned checksum, extracts the SDK into a temporary directory, rebuilds the native bridge for both Apple Silicon and Intel, copies only the required redistributable runtime and notices, confirms the bridge is using the real Discord Social SDK, and packages the DMG and ZIP into `release/`. It deletes the temporary extracted SDK afterward. The original SDK ZIP remains outside the repository and must never be uploaded as a release asset.

This local path is the supported route for the ad-hoc-signed macOS beta when no durable Discord SDK download credential exists. Upload only the generated application release assets. The end user does not download or configure the Discord SDK.

## Release procedure

1. Update the version and changelog; audit lockfile changes and third-party notices.
2. Run `npm ci`, formatting, lint, typecheck, tests, production dependency audit, application build, and native stub tests locally. Run `node scripts/validate-release.mjs vX.Y.Z` after updating every manifest; the tag, root package, desktop package, core package, and native CMake project must use the same exact version.
3. Test a production bridge against the exact checksummed SDK on each target. The bridge must report `mode=discord-social-sdk`; abort if it reports `stub`.
4. Complete `docs/manual-test-matrix.md` using a real Roon Server and Discord Stable/PTB/Canary where available. Record the expected Gatekeeper warning and approve beta exceptions explicitly for every platform.
5. Create and push a signed, protected `vX.Y.Z` tag, then create draft GitHub release notes for that tag.
6. Dispatch the **Release** workflow on the tag itself with `gh workflow run release.yml --ref vX.Y.Z -f tag=vX.Y.Z`. The GitHub web form only offers a branch selector and cannot satisfy the workflow's tag-ref guard. Protected jobs reject branch dispatches and mismatched dispatch/input tags, validate version consistency, download and verify the SDK, compile and preflight a production-mode bridge, restore native executable permissions, package beta installers, generate checksums and an SBOM, attest an explicit allowlist of artifacts, and upload them to an empty draft release.
7. Verify the macOS app is ad-hoc signed and not notarized. Compare every artifact against `SHA256SUMS.txt`, inspect the SBOM, install each package, and repeat the short smoke section of the manual matrix.
8. Publish the GitHub release. Mark every platform asset as beta in filenames and release notes. Automatic updates remain disabled until macOS has a stable Developer ID signing identity.

Never place SDK files, certificates, passwords, tokens, Apple credentials, notarization profiles, builder debug files, or effective builder configuration in the repository, workflow logs, or release assets. A failed checksum, signing, notarization, provenance, version, executable-mode, or production-bridge check blocks publication. Release assets are immutable: the workflow refuses to overwrite an existing asset, so discard a failed draft and investigate instead of rerunning with replacement semantics.

For macOS SDK 1.10.18687, stage only `discord-bridge`, `libdiscord_partner_sdk.dylib`, and `DiscordSocialSdk-License-Notices.txt` in the bridge resource directory. The partner dylib is universal and has install name `@rpath/libdiscord_partner_sdk.dylib`; the bridge uses `@loader_path`. It has no load dependency on `libdiscord_krisp.dylib`, so do not package the Krisp library or model files for this Rich Presence-only app. The dylib's signature from the supplied ZIP does not pass strict local verification, so the complete beta app, including nested code, must be freshly ad-hoc signed during packaging.

## Rollback

GitHub releases are immutable records; do not silently replace a published binary. For a severe defect, disable/remove the affected update metadata, mark the release as withdrawn, publish a security advisory when appropriate, and ship a higher patch version. Preserve hashes and affected-version details for incident review.

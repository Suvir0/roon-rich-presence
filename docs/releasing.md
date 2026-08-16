# Releasing

macOS is the stable channel. Windows x64 and Linux x64 (`AppImage` and `.deb`) are explicitly beta. Flatpak and Snap are not produced because their sandboxes can hide Discord IPC. Linux support also depends on the Social SDK's current experimental platform support.

## One-time prerequisites

- Confirm the application identity, repository, publisher, support contact, and icons before the first public release. These values are currently frozen for `Suvir0/roon-rich-presence` and `io.github.suvir0.roon-rich-presence`; changing the Roon extension ID after release requires users to authorize it again.
- Add non-secret repository variables `DISCORD_APPLICATION_ID`, `ROON_EXTENSION_ID`, `PROJECT_CONTACT_URL`, `PROJECT_PUBLISHER`, and `PROJECT_SUPPORT_EMAIL`; release builds bake these public identifiers into the packaged main process.
- Create a Discord application, record its numeric Application ID, upload the branded fallback asset, accept the Social SDK terms, and confirm redistributable files for every target.
- Configure protected GitHub environments named `discord-social-sdk` and `release-signing`, each requiring reviewer approval and restricting deployment to protected tags.
- Record `DISCORD_SDK_ARCHIVE_URL`, `DISCORD_SDK_SHA256`, and `DISCORD_SDK_DOWNLOAD_TOKEN` in `discord-social-sdk`. The URL must be HTTPS and the checksum must be obtained independently of the archive download. For the validated 1.10.18687 archive, the SHA-256 is `7041ca2c9de67ed923d2f626d1982aa397a89566da5a945e3605110a2ff9f207`.
- Add macOS secrets `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `CSC_LINK`, and `CSC_KEY_PASSWORD`. `CSC_LINK` contains the Developer ID Application certificate accepted by electron-builder.
- Add Windows secrets `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` before promoting Windows out of beta. Unsigned beta builds must be clearly labeled and require explicit approval.
- Enable GitHub private vulnerability reporting, secret scanning/push protection, branch protection, required test/security checks, and immutable releases where repository policy permits.

The local 0.1.1 validation used Discord Social SDK 1.10.18687 with archive SHA-256 `7041ca2c9de67ed923d2f626d1982aa397a89566da5a945e3605110a2ff9f207`. Re-verify this value independently before reusing that archive in release infrastructure.

## Release procedure

1. Update the version and changelog; audit lockfile changes and third-party notices.
2. Run `npm ci`, formatting, lint, typecheck, tests, production dependency audit, application build, and native stub tests locally. Run `node scripts/validate-release.mjs vX.Y.Z` after updating every manifest; the tag, root package, desktop package, core package, and native CMake project must use the same exact version.
3. Test a production bridge against the exact checksummed SDK on each target. The bridge must report `mode=discord-social-sdk`; abort if it reports `stub`.
4. Complete `docs/manual-test-matrix.md` using a real Roon Server and Discord Stable/PTB/Canary where available. macOS must have no blocking result; approve beta exceptions explicitly for Windows/Linux.
5. Create and push a signed, protected `vX.Y.Z` tag, then create draft GitHub release notes for that tag.
6. Run the **Release** workflow manually with the exact tag. Protected jobs verify that the input is an existing `vX.Y.Z` tag at the checked-out commit, validate version consistency, download and verify the SDK, compile and preflight a production-mode bridge, restore native executable permissions, package/sign/notarize installers, generate checksums and SBOM, attest an explicit allowlist of artifacts, and upload them to an empty draft release.
7. Verify signatures and notarization from a clean machine. Compare every artifact against `SHA256SUMS.txt`, inspect the SBOM, install each package, and repeat the short smoke section of the manual matrix.
8. Publish the GitHub release. Mark Windows and Linux assets as beta in both filenames/release notes. Confirm the signed update metadata is served before enabling automatic updates for the new version.

Never place SDK files, certificates, passwords, tokens, Apple credentials, notarization profiles, builder debug files, or effective builder configuration in the repository, workflow logs, or release assets. A failed checksum, signing, notarization, provenance, version, executable-mode, or production-bridge check blocks publication. Release assets are immutable: the workflow refuses to overwrite an existing asset, so discard a failed draft and investigate instead of rerunning with replacement semantics.

For macOS SDK 1.10.18687, stage only `discord-bridge`, `libdiscord_partner_sdk.dylib`, and `DiscordSocialSdk-License-Notices.txt` in the bridge resource directory. The partner dylib is universal and has install name `@rpath/libdiscord_partner_sdk.dylib`; the bridge uses `@loader_path`. It has no load dependency on `libdiscord_krisp.dylib`, so do not package the Krisp library or model files for this Rich Presence-only app. The dylib's signature from the supplied ZIP does not pass strict local verification, so the complete app—including the nested bridge and dylib—must be freshly signed with the project's Developer ID identity before notarization.

## Rollback

GitHub releases are immutable records; do not silently replace a published binary. For a severe defect, disable/remove the affected update metadata, mark the release as withdrawn, publish a security advisory when appropriate, and ship a higher patch version. Preserve hashes and affected-version details for incident review.

# Security policy

## Supported versions

Security fixes are provided for the latest published release. macOS is the stable target; Windows and Linux packages remain beta until their release checklist is completed.

## Report a vulnerability

Please use GitHub's private **Report a vulnerability** form under the repository Security tab. Do not open a public issue or include listening metadata, Roon authorization data, access tokens, or signing material in a report. If private reporting is unavailable, contact the support address listed in the latest release notes and request an encrypted reporting channel.

We aim to acknowledge a report within 3 business days, provide an initial assessment within 7 business days, and coordinate disclosure after a fix is available. These targets are not a bug-bounty promise.

## Security model

- The app is local-first and does not operate a hosted backend.
- The renderer is sandboxed and receives only validated, typed IPC capabilities.
- Roon authorization is encrypted with Electron `safeStorage` when the operating system provides a secure backend. Linux users are warned when secure storage is unavailable.
- Album matching is optional and sends only artist and album text to MusicBrainz. Local artwork, listening history, Discord identity, and Roon authorization are never uploaded.
- The native bridge accepts bounded newline-delimited JSON only from its parent process. It does not listen on a socket.
- There is no telemetry or automatic crash upload. Redacted diagnostics remain local unless the user explicitly copies and shares them.

## Supply-chain policy

JavaScript dependencies are pinned by the npm lockfile; GitHub Actions use reviewed major versions and receive automated update proposals. The official Discord Social SDK is downloaded only in a protected release environment, verified against an independently recorded SHA-256 digest, and is never committed to this repository. Releases include checksums, a CycloneDX SBOM, and GitHub build provenance. Signing credentials are environment-scoped GitHub secrets and must never be available to pull-request workflows.

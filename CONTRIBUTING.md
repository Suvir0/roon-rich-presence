# Contributing

Thanks for helping improve Roon Rich Presence.

## Before opening a change

For a bug fix, open an issue or describe the exact behavior in the pull request. For a larger feature, open a feature request first so the user experience and privacy impact can be discussed before implementation starts.

Never commit Roon authorization data, `.env` files, Discord SDK archives, signing certificates, download tokens, or packaged release binaries.

## Development

Follow the development setup in [README.md](README.md). Before opening a pull request, run:

```sh
npm run secrets:check
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

Changes to the native bridge should also run its CMake and CTest workflow. Changes to packaging, permissions, onboarding, tray behavior, Roon connectivity, or Discord publishing should update the manual test matrix when needed.

## Pull requests

Keep pull requests focused. Explain the user-visible impact, testing performed, and any privacy, security, signing, or release consequences. Screenshots are useful for interface changes, but remove personal listening information first.

By contributing, you agree that your work is provided under the repository's MIT License.

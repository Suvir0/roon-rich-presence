# Third-party notices

Roon Rich Presence is an independent project and is not affiliated with, endorsed by, or sponsored by Roon Labs or Discord Inc. “Roon” and “Discord” are trademarks of their respective owners.

The application incorporates open-source packages whose licenses and copyright notices are distributed in the packaged application's license bundle and represented in the release SBOM. The authoritative dependency list is the npm lockfile.

## Roon API

The Roon Node API and its Transport, Image, and Status services are used under their respective repository licenses. They are pinned to reviewed Git commit hashes in the application manifest. No Roon artwork or brand assets are redistributed by this project.

## Discord Social SDK

Production packages load Discord's official Social SDK. The SDK is proprietary and governed by the [Discord Social SDK Terms](https://support-dev.discord.com/hc/en-us/articles/30225844245271-Discord-Social-SDK-Terms) and the terms delivered with the SDK. Its source archive and redistributable binaries are not part of this repository. Maintainers must accept the applicable terms and confirm redistribution rights before publishing an installer.

Version 0.1.3 is built and tested against Discord Social SDK 1.10.18687. The SDK-provided `License-Notices.txt` is bundled beside the native bridge as `DiscordSocialSdk-License-Notices.txt`.

## MusicBrainz and Cover Art Archive

Optional album matching queries MusicBrainz data and uses front-cover URLs from the Cover Art Archive. Their data, service terms, and individual cover images may have separate licenses. The app does not claim ownership of returned metadata or artwork and does not redistribute a bulk artwork collection.

## Cormorant Garamond and Lora fonts

The interface typefaces Cormorant Garamond and Lora are © their respective designers and are licensed under the SIL Open Font License, Version 1.1 (https://openfontlicense.org). Variable-font woff2 files are vendored under `apps/desktop/src/renderer/fonts/` and served locally; the application never fetches fonts from Google Fonts or any other network host.

Run the release SBOM and license-notice generation steps for every release. A release must be blocked if a required notice is absent or a dependency license is incompatible with distribution.

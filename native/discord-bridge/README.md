# Discord bridge

This process is the only component that loads Discord's official Social SDK. It accepts bounded, flat newline-delimited JSON on standard input and writes one JSON event per line to standard output. Logs must go to standard error so they cannot corrupt the protocol.

## Build

Development and CI use a stub that validates the protocol but never contacts Discord:

```sh
cmake -S native/discord-bridge -B build/discord-bridge -DRRP_DISCORD_STUB=ON
cmake --build build/discord-bridge
ctest --test-dir build/discord-bridge --output-on-failure
```

Production builds require an approved, checksummed Social SDK archive extracted outside the repository. The validated release is **Discord Social SDK 1.10.18687**, whose original ZIP has SHA-256 `7041ca2c9de67ed923d2f626d1982aa397a89566da5a945e3605110a2ff9f207`:

```sh
cmake -S native/discord-bridge -B build/discord-bridge \
  -DRRP_DISCORD_STUB=OFF \
  -DDISCORD_SOCIAL_SDK_ROOT=/absolute/path/to/discord-social-sdk
cmake --build build/discord-bridge --config Release
```

The root may be either the extracted archive directory or its `discord_social_sdk` child. The C++ binding requires `DISCORDPP_IMPLEMENTATION` in exactly one translation unit; this is isolated in `backend_discord.cpp`.

`cmake --install` stages the bridge, the matching `discord_partner_sdk` runtime, and `DiscordSocialSdk-License-Notices.txt`. On macOS 1.10.18687, package `libdiscord_partner_sdk.dylib` beside `discord-bridge`; both are linked through `@loader_path`. The release dylib is universal (`arm64` and `x86_64`) and does not link to `libdiscord_krisp.dylib`, so the Krisp library/models are not required for Rich Presence. Never commit SDK archives or binaries.

## Protocol

Launch with `discord-bridge --application-id <uint64>`. The bridge first emits `ready`. Supported commands are:

```json
{"command":"set_activity","request_id":"1","details":"Track","state":"Artist · Album","large_image":"https://coverartarchive.org/...","large_text":"Album","small_image":"app","small_text":"Living Room","start_timestamp":1700000000,"end_timestamp":1700000200}
{"command":"clear","request_id":"2"}
{"command":"shutdown","request_id":"3"}
```

Strings are UTF-8 and timestamps are non-negative Unix seconds; the SDK adapter converts them to the milliseconds required by 1.10.18687. The parser rejects duplicate/unknown keys, nested values, malformed JSON, overlong fields, unsafe timestamp overflow, and input over 16 KiB. `set_activity` requires non-empty `details`. Output events are `ready`, `status`, `connected`, `disconnected`, or `error` and echo `request_id` when available.

The main loop polls stdin while pumping SDK callbacks every 16 ms. It retains the desired activity, retries failures with capped exponential backoff, and refreshes every 20 seconds so presence is restored after Discord launches or restarts without violating Discord's activity update limit.

The stub identifies itself with `"mode":"stub"` and `"connected":false`; it must never be included in a production package.

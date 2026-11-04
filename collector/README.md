# Deadlock AR broadcast collector

A local Node 24 companion using Deadem 4.0.2. One worker follows one Valve spectator broadcast; any number of OBS views share its snapshots. It never reads game memory, injects into the client, or contacts Tracklock.

## Run

On Windows, open `Start-Collector.cmd` in the project root. The portable release contains Node, dependencies, and the built website, so it needs no installation. A source checkout requires Node 24 with npm; the launcher installs the locked collector dependencies and builds the website if needed. Alternatively:

```sh
npm ci
npm run collector:setup
npm run build
npm run collector
```

Open **http://127.0.0.1:8766/?tab=live** on the broadcast PC. Keep the terminal open. This local studio is the same frontend as the Vercel website. The continuous collector runs locally; the existing free Vercel project does not need to host it. The public website can also connect from the same PC if its browser permits loopback access. OBS and a second admin computer cannot use another PC's `127.0.0.1` address; this version is intended for the broadcast PC.

Enter a currently watchable match ID, choose **Live broadcast**, and start. A direct Valve broadcast URL is optional; supplying one bypasses the public API's match-to-relay discovery. Otherwise discovery uses Deadlock API once. Reconnect attempts reuse the resolved relay, with bounded backoff. An unavailable relay cannot be bypassed.

Start collecting before game end. When the spectator feed reports game over, the last complete match state and winner are saved. An interrupted connection, stopped collector, or exhausted retry budget does not create a final result. The snapshot is available as soon as the collector receives the end signal; the relay's own broadcast delay still applies.

## OBS and results

- **Live stat panels:** compact damage, permanent pickups, souls, and healing panels for all twelve players. Unknown values remain unknown. Each source URL pins its match ID and metric.
- **Ultimate HUD:** calibrate the reference portrait positions and order against the game HUD. The actual transparent source draws only ability badges beside affected players. Exact ultimate ability IDs generate enemy damage-hit flashes; self effects and utility casts do not generate hit claims. Active target modifiers are enabled for Wraith, Paradox, Grey Talon, and Holliday using replay-verified mappings. The coverage list shows the distinction. Copied or secondary ability IDs and future patches need additional validation.
- **Post-match scoreboard:** inspect the saved capture and confirm the winner. Branding, logos, series score, format and game number come from **Broadcast settings**; scores are not automatically incremented. Player display-name overrides are stored per match. **Publish reviewed scoreboard** freezes the reviewed version for the scoreboard OBS URL. Later edits do not silently change it.
- **Verify with finished metadata:** optional after capture. This updates the review copy from Deadlock API when available, preserving collected names. The existing on-air copy remains fixed until republished. Captured values can differ from metadata arriving later, especially net worth or healing around the last tick; the capture is labelled for review.
- **Delay:** the added delay applies to collector OBS views, not the admin review screen. It does not remove Valve's delay. If gameplay reaches OBS before data, delay the game/video source instead. Test this against a recording before tournament use.

Use 1920 × 1080 OBS Browser Sources and their visibility/hotkeys to show panels or the scoreboard. The HUD uses a transparent background. A disconnected or stale feed suppresses transient badges rather than leaving stale stuns on screen. Paused game state is included in snapshots. Publishing never controls OBS or starts a stream.

`Replay rehearsal` downloads a recent Valve replay and runs the same extraction worker at 1×/4×/16×/32×, with an optional starting minute. It is explicitly labelled as a rehearsal. It can be rerun; an already published scoreboard remains fixed during the next rehearsal. This is useful for calibrating badges without waiting for a live tournament.

## Storage, updates, and tests

Match snapshots and published results are written atomically to `.dlar-collector/MATCH_ID.json` in the project root. Keep this folder when updating the app. Results survive a process restart; unfinished sessions require explicit reconnection. No raw game memory or personal Steam profile details are collected. Player Steam account IDs and in-game names are used for identity and future series aggregation.

`npm run collector:refresh` refreshes the cached permanent-pickup and ultimate definitions; rebuild the frontend afterward. Definitions are bundled and do not require a catalogue request on every live update. Relay discovery, optional finished-result verification, replay lookup, and catalogue refresh use the public Deadlock API; live parsing runs locally. Asset images can require internet access.

```sh
npm test
npm run lint
npm run build
node collector/verify-replay.mjs MATCH_ID path/to/match.dem.bz2 path/to/reference-metadata.json
```

The verifier also accepts raw `.dem`, BZip2, and Zstandard files (Valve's `.bz2` suffix can contain Zstandard). No replay, match archive, or runtime executable is committed to Git. The worker is isolated from the HTTP server so parsing does not block OBS requests.

Real replay **120901644**: 12 players, 129 permanent pickups, winner and final K/D matching metadata, 18:23 duration. The worker recovered damage-hit indicators and all four supported target-effect mappings. Live custom-lobby behavior, long broadcasts, future patches, video-delay alignment, and unusual cleanse/immunity interactions still need tournament rehearsal.

The server binds to loopback only, restricts request origins and relay hosts, and accepts mutations as JSON. Its API supports health, start/stop, match-scoped SSE, saved state, presentation settings, metadata verification, and publishing. `DLAR_DATA_DIR` changes the archive location; `DLAR_ALLOWED_ORIGINS` can explicitly add an admin frontend origin. No credentials or paid service are required.

Deadem and its engine are MIT licensed: [source and licence](https://github.com/Igor-Losev/deadem). Distributed dependencies retain their own licence files. The portable Node runtime includes Node's complete third-party licence notice.

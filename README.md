# Deadlock AR — Broadcast Studio

A shared tournament broadcast dashboard in the community’s parchment and olive identity. Railway hosts the website, Statlocker connection, password-protected controls, reports and persistent SQLite workspace. The observer companion reads a growing local Deadlock recording on whichever PC is observing and sends normalized statistics outward over HTTPS. The five OBS URLs stay the same when observers change.

## Observer workflow

1. Open **Live desk** in the hosted studio. Download and extract the observer ZIP on the observer PC, then open **Start-Observer.cmd**. The official Windows x64 Node.js 24.19.0 runtime and pinned parser are bundled. No installation or administrator access is needed. Packaging verifies the official runtime against its pinned SHA-256.
2. Create a pairing code in Live desk. Enter it and the studio website address in the companion. The single-use code expires after five minutes. The companion stores a scoped publisher credential locally; it never needs the admin password. **Disconnect computer** revokes it.
3. Join the custom lobby’s spectator slot before the host starts the game. The host must enable cheats for recording. Prepare a new recording in the companion and enter its fresh `record ...` command in Deadlock’s console before the countdown.
4. Keep the companion open. It waits for the file, sends player statistics, permanent pickups, bridge buffs, purchase history and supported ultimate indicators, and retries temporary network interruptions. Use **Resume previous recording** after a companion restart. File replacement/truncation fails explicitly rather than mixing games.
5. After the match ends, enter `stop` in Deadlock. A real game-over signal saves final results; stopping or losing the file does not invent a final result. Review and publish the scoreboard in Live desk.

One publisher is active at a time. Switching recordings fences the previous process. A local UUID identifies the game before a numeric Valve match ID exists. Replay/relay collection remains an explicit fallback in Live desk; it cannot run alongside the observer and does not automatically replace it.

The companion uses the same pinned Deadem 4.0.2 decoder with a client-demo adapter for clear/create ordering and entity baseline updates. Demofusion is not required for this integration. The adapter uses private parser internals and intentionally stops on unsupported formats. Validate new game/parser versions before an event.

## Drafts and tournament images

The current catalogue has 44 selectable heroes, including Violet and Nurse Harrow, with normal/gloat/critical portraits and selection voices. Portraits and the new voices are bundled with the site. Refresh with `npm run update:heroes`; new selection voices are resolved from VLViewer’s versioned manifest rather than guessed filenames.

Manual drafts use the supplied 18-step competitive three-ban sequence. Live drafts follow the source’s received order. The opening ban round contains two bans per side; Hidden King’s first pick and both Archmother opening picks receive the first-round marker. Historical archives preserve their source order and rule identifier.

Draft selections are saved as they arrive. Reconnecting a Statlocker code updates its existing archive. Use **Start next manual draft** to archive the old board and clear it for another game. In **Tournament reports**, select drafts and export the hero-priority PNG. Select completed games for item reports and optional comparison cohorts. Mid-game/incomplete recordings are excluded by default.

Purchase reports count transaction events, not inventory snapshots. Duplicate ability-change/purchase notifications are reconciled. A full return is cancelled using refund eligibility or an exact full-cost currency receipt; a later partial sale retains the purchase. Returns without enough source evidence are flagged for operator review and block export. Retained pending purchases are confirmed at recorded game end. Components are counted when bought, not again when consumed by an upgrade. Buying the upgrade itself is a separate purchase. Bot IDs are synthetic rehearsal identities, never substituted for real account IDs.

Series MVP combines selected ended-game totals, lets the operator choose a player, exports a PNG and publishes the card through the existing scoreboard URL. Publishing another match result switches that URL back to the scoreboard.

## Synchronization and acceptance checks

The recording source removes the Valve relay’s source delay; it does not guarantee a fixed end-to-end delay. The saved player-slot capture produced 1,519 complete 12-player samples with the integrated reader. A staged growing-file replay produced 1,447 samples before writing finished. These tests recovered four permanent buffs, bridge-buff presence, and two full item refunds. They did not validate a tournament spectator’s visibility of every item transaction or measure video synchronization.

Before a tournament, run one full 12-player custom-lobby spectator recording from countdown through game over. Check both teams’ purchases/refunds/sales, all buff indicators, final totals, restart recovery and a caster’s received video. A player-slot success is not proof of spectator coverage. Unknown values remain unknown. Catalogue ultimate IDs are candidates, not universal proof of provenance: Graves’ ambiguous second-ability zombie damage is suppressed. Four lasting-effect mappings were replay-verified; new effects still need ability-specific validation.

Delay observer gameplay video and game audio together **before** adding the graphics, then send that combined view to the remote casters. Add their returning microphones in the final production mix. Compare source game clocks and measure the actual setup. **Additional graphics delay** only delays graphics and cannot compensate for late data. OBS’s whole-stream delay alone does not change alignment between layers. Preserve the opening by beginning capture and recording before the match starts.

Recorded console entries provide a partial audit only. They cannot prove that every player’s console commands or cheat use were captured. This implementation uses neither process-memory hooks nor injection.

## Backups and recovery

All admins share SQLite on Railway’s `/data` persistent volume. **OBS outputs** offers a full JSON backup and daily compressed recovery files. The daily file is refreshed every minute; 14 days are retained on the same volume. Download a copy outside Railway for independent recovery. Credentials and active publisher leases are excluded from exported backups.

Stop collection, choose a JSON or `.json.gz` backup, review its game/draft counts and click **Restore this backup**. Matching archives and controls are restored; unrelated saved games remain. The current state is backed up before restoring. Observer PCs must pair again if their original credential was lost; backup imports never create publisher access.

## Permanent OBS outputs

| Output                         | Path             |
| ------------------------------ | ---------------- |
| Draft                          | /obs/draft       |
| Deadlock API stats             | /obs/live-events |
| Deadem stats                   | /obs/deadem      |
| Reviewed post-match scoreboard | /obs/scoreboard  |
| Ultimate indicators            | /obs/ultimates   |

Copy the full URLs from **OBS outputs**. Add each source at **1920 × 1080**. Match IDs, branding, statistics and HUD calibration are stored on the server; changing them does not change the URLs. The scoreboard follows the latest explicitly published result, even after another game is selected. Hide/show controls are shared.

OBS outputs are publicly readable; dashboard controls, saved-game archives and backups require the admin password. Enable **Control audio via OBS** for draft voice lines. Existing picks establish a silent baseline when a source reconnects.

## Operator workflow

1. Sign in. All admins use the same workspace.
2. Set team names, logos, series score, event and game number.
3. In **Draft studio**, connect a Statlocker link or use manual/demo mode. The backend sends spectator messages only; decisions remain in Statlocker. Private-room passwords stay in memory, never in URLs or saved snapshots.
4. Choose a stats source:
   - **API stats** provides compact finished-match panels and the alternative Deadlock API live-events feed. Live permanent buffs are unavailable from this feed.
   - **Deadem stats** uses Valve broadcast/replay data for live panels, permanent pickups, ultimate indicators and saved results. It runs on the server. Enter the match ID, or test with replay rehearsal.
5. Calibrate ultimate badges against the game HUD and set any additional video delay. Calibration, display names and the selected statistic are shared.
6. After an actual game-over signal, review the captured scoreboard, optionally verify against finished metadata, then **Publish reviewed scoreboard**. Later edits and verification stay off air until you publish again.

Spectator availability depends on Valve’s relay and the lobby. A cloud server cannot make an unwatchable match available. Stopping the collector or losing its connection never invents a game-over result. Last values remain saved; stale feeds are labelled and transient badges expire. Ultimate damage-hit detection uses exact ability IDs; lasting effects are enabled only for replay-verified abilities. See dashboard detection coverage and [collector documentation](collector/README.md).

## Railway setup

Use an independent project in your Railway workspace. Another repository in the GitHub organization can continue using a friend’s separate Railway workspace.

1. Grant the Railway GitHub App access to **deadlock-ar/broadcast-studio** if needed. GitHub sign-in alone does not guarantee repository access. Preserve any existing organization repository selections.
2. Connect the reviewed cloud branch to one service. Railway detects the root **Dockerfile**, which builds Vite and installs collector dependencies.
3. Attach **one persistent volume at /data**. Keep exactly **one service replica** because SQLite and the collector share one process.
4. Set the variables below. Enter the production password directly in Railway, outside GitHub and chat.
5. Configure **/healthz**, a 60-second startup timeout, restart on failure (5 retries), and serverless sleeping. Generate a Railway HTTPS domain. Set PUBLIC_ORIGIN to that exact origin.
6. Deploy, sign in and rehearse with a replay. Keep the existing Vercel site available until cloud verification is complete.

| Variable       | Value                                                |
| -------------- | ---------------------------------------------------- |
| ADMIN_PASSWORD | A unique 16–512 character admin password             |
| DLAR_DATA_DIR  | /data                                                |
| PUBLIC_ORIGIN  | Exact HTTPS website origin, without a trailing slash |
| NODE_ENV       | production                                           |
| PORT           | Provided by Railway; hosted app binds to 0.0.0.0     |

Without PUBLIC_ORIGIN the app uses RAILWAY_PUBLIC_DOMAIN. Use one canonical admin origin: writes from another origin are rejected. Login cookies are HttpOnly, SameSite=Strict and Secure on HTTPS. Sessions expire after seven days; changing ADMIN_PASSWORD revokes them.

Trial can be used for rehearsal if its network/resource limits permit the collector. A monthly plan fee is not a cap on usage. Stop collectors/API feeds after events and close dashboard tabs and unused OBS Browser Sources so the service can sleep. Warm it up before a broadcast. An active collector intentionally keeps working.

The Dockerfile defines the build. Healthchecks, sleeping and resource limits are Railway service settings rather than relying on deprecated railway.json configuration. References: [GitHub autodeploys](https://docs.railway.com/deployments/github-autodeploys), [Dockerfiles](https://docs.railway.com/builds/dockerfiles), [volumes](https://docs.railway.com/volumes), [serverless](https://docs.railway.com/deployments/serverless).

## Persistence and recovery

SQLite at /data/broadcast.sqlite stores branding, draft state, selected feeds, collector settings, captures and published scoreboards. Leaf-level edits merge changes to different fields. Conflicting edits to the same field are rejected and shown to the admin. Unique update IDs prevent duplicate application after retries.

Restarting restores saved screens, selected game and published result. Active feeds are marked disconnected/interrupted: reconnect from the dashboard. Private Statlocker passwords are not restored. OBS clients reconnect automatically at their permanent paths.

Download **workspace and results backup** from OBS outputs after each event. It includes workspace configuration and captures, excluding passwords and login sessions. Retain independent copies alongside Railway volume backups. Legacy collector JSON captures placed in the data directory are imported once and preserved. A full backup restore currently requires server access.

Do not use multiple replicas with this SQLite deployment. Horizontal scaling would need a shared database and collector coordination. MVP graphics, brackets and highlights remain future roadmap work.

## Local development and rehearsal

Use **Node.js 24 or newer**:

```sh
npm ci
npm run collector:setup
npm test
npm run lint
npm run build
npm start
```

The combined server defaults to **http://127.0.0.1:8766**. Choose another DLAR_COLLECTOR_PORT if the older collector is running. Without a password it binds to loopback only for trusted local development. Set ADMIN_PASSWORD and PUBLIC_ORIGIN to rehearse hosted login. Set DLAR_DATA_DIR to a separate test directory to isolate rehearsal data.

**npm run dev**, **npm run preview:built**, and the existing Vercel static deployment retain the legacy browser-local interface; they do not provide the shared backend. Their old query-string links are separate from the shared outputs. **npm run collector** starts the old local companion; **npm start** starts the combined server. Use different ports for the two.

## Hero and protocol maintenance

**npm run update:heroes** refreshes draft hero metadata/artwork; rebuild afterward. **npm run collector:refresh** refreshes the ability catalogue. Validate newly added ultimate effects against a replay before enabling them. Unknown heroes display a fallback. Source protocol changes can require collector updates.

The Statlocker adapter in src/draft.js connects to wss://statlocker.gg/ws/draft with JOIN_DRAFT and the SPECTATOR role. It never sends pick, ban, start, pause or owner commands. The observed spectator protocol is not a documented public API.

## Validation

**npm test** covers draft transport/effects, finished stats, live events, collector extraction, buffs, ultimate filtering/expiry, delayed outputs, frozen scoreboards, shared-edit conflicts, authentication, password rotation and SQLite recovery. Lint and production build validate frontend/server sources. Hosted reachability, container startup and resource usage still need first-deployment verification.

Hero art and voices belong to their respective rights holders. Community branding comes from the supplied project. Bundled fonts and dependencies retain their included licences.

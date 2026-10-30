# Deadlock AR — Broadcast Studio

A shared tournament broadcast dashboard in the community’s parchment and olive identity. Railway hosts the website, Statlocker connection, password-protected controls, reports and persistent SQLite workspace. The observer companion reads a growing local Deadlock recording on whichever PC is observing and sends normalized statistics outward over HTTPS. OBS URLs stay the same when observers change.

## Tournament selection and data management

The selector above every admin tab creates or loads the current tournament for all admins. Each tournament retains its own draft board, match collection, branding and scores, report selections, manual MVP and published-output selection. New recordings and draft archives receive a stable tournament ID; changing a tournament name does not move its records. Existing archives are assigned using their saved event labels on first upgrade.

Stop active recording/relay collection before switching tournaments. Reconnect a live draft after loading its tournament. The permanent OBS URLs follow the current tournament, so switch during a scene break. Late observer updates and stale admin edits are rejected rather than applied to another tournament.

**Data library** lists games, drafts, tournaments, Trash and backups. Games and drafts can be filtered to the current tournament or shown across all tournaments. Deleting a tournament includes its games and drafts; select another tournament first. Deletion removes records from report selections and on-air outputs, and sends them to Trash. Restore retains the data without republishing it. Series scores remain operator controlled when records are deleted or restored. Permanent deletion requires typing `DELETE`; independent backup copies may still contain the data. Deleted recording IDs cannot silently resume as new games.

Backups include all tournament workspaces and recoverable deleted records. Old backups remain supported. The Data library also provides backup download/restore and explicit removal of recovery files; the automatic daily file may be recreated on the next backup cycle.

In **Tournament reports → Series MVP**, choose **Enter manually** to set the player name, hero, kills, deaths, assists, damage and souls without collecting a game. These values are shared, saved for that tournament and used by the existing preview, PNG export and Series MVP OBS URL. Blank statistics remain unknown. The scoreboard, hero-priority and Series MVP graphic designs are unchanged in this update, pending a separate design discussion.

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

Manual drafts offer the supplied 18-step competitive three-ban sequence and the classic 16-step two-ban sequence. Changing the format archives the current board; new manual drafts and rehearsals retain that format. Live drafts follow the source’s received order. Opening-round markers follow each draft’s actual order: the three-ban format opens with two bans per side, Hidden King’s first pick and both Archmother opening picks. Historical archives preserve their source order and rule identifier.

Draft selections are saved as they arrive. Reconnecting a Statlocker code updates its existing archive. Use **Start next manual draft** to archive the old board and clear it for another game. In **Tournament reports**, select drafts and export the hero-priority PNG. Select completed games for item reports and optional comparison cohorts. Mid-game/incomplete recordings are excluded by default.

Purchase reports count transaction events, not inventory snapshots. Duplicate ability-change/purchase notifications are reconciled. A full return is cancelled using refund eligibility or an exact full-cost currency receipt; a later partial sale retains the purchase. Returns without enough source evidence are flagged for operator review and block export. Retained pending purchases are confirmed at recorded game end. Components are counted when bought, not again when consumed by an upgrade. Buying the upgrade itself is a separate purchase. Bot IDs are synthetic rehearsal identities, never substituted for real account IDs.

Hero priority, top items and series MVP have separate permanent OBS URLs. Their previews, PNG exports and OBS sources use the same parchment/olive renderer. Series MVP uses the hero’s on-fire portrait and selected ended-game totals. These reports never replace the published match scoreboard.

## Updated live desk and scoreboard

Download the updated observer ZIP (companion 0.2.0) on each observer PC. It includes all-entity parsing for held items, objective damage, the numeric match ID and four signature ability upgrades. Older saved captures cannot gain data that their companion never sent. Recognized packed ability encodings map to upgrade tiers 0–3; unfamiliar encodings stay unknown. Confirm these tiers against the game during the next spectator rehearsal.

Permanent-buff panels accept the local-recording source. Ultimate actor/victim lookup includes bot identities for custom-lobby tests and follows owner handles for summons/projectiles; the ambiguous Graves zombie ability remains suppressed. These fixes address reproducible source-filter and attribution failures, but ability-specific coverage still requires spectator recordings.

Panel controls restore player tiles, ranked lists, team columns, themes, width, continuous scaling, text size and exact X/Y coordinates on the 1920 × 1080 canvas. The `/obs/deadem` link is labelled **Live stats panel**. Legacy API controls are under **Broadcast settings → Optional tools**; their old URL still works.

The scoreboard shows souls, K/D/A, hero damage, objective damage and healing, held items, four ability upgrade tiers, team kill/soul totals and numeric match ID. A newly ended game adds one series point; retries, reconnects and republishing do not add another. Replay/rehearsal games do not award points. Previous finished archives are not automatically counted after upgrading.

The recording has not yet demonstrated the official post-game awards message. **Verify with finished metadata** uses the captured numeric match ID, preserves recorded loadouts and imports official MVP/key-player ranks when available. Operators can choose an MVP immediately; otherwise the footer identifies explicit damage/objective/healing leaders. No calculated leader is presented as an official game award.

## Synchronization and acceptance checks

The recording source removes the Valve relay’s source delay; it does not guarantee a fixed end-to-end delay. The saved player-slot capture produced 1,519 complete 12-player samples with the integrated reader. A staged growing-file replay produced 1,447 samples before writing finished. These tests recovered four permanent buffs, bridge-buff presence, and two full item refunds. They did not validate a tournament spectator’s visibility of every item transaction or measure video synchronization.

Before a tournament, run one full 12-player custom-lobby spectator recording from countdown through game over. Check both teams’ purchases/refunds/sales, all buff indicators, final totals, restart recovery and a caster’s received video. A player-slot success is not proof of spectator coverage. Unknown values remain unknown. Catalogue ultimate IDs are candidates, not universal proof of provenance: Graves’ ambiguous second-ability zombie damage is suppressed. Four lasting-effect mappings were replay-verified; new effects still need ability-specific validation.

Delay observer gameplay video and game audio together **before** adding the graphics, then send that combined view to the remote casters. Add their returning microphones in the final production mix. Compare source game clocks and measure the actual setup. **Additional graphics delay** only delays graphics and cannot compensate for late data. OBS’s whole-stream delay alone does not change alignment between layers. Preserve the opening by beginning capture and recording before the match starts.

Recorded console entries provide a partial audit only. They cannot prove that every player’s console commands or cheat use were captured. This implementation uses neither process-memory hooks nor injection.

## Backups and recovery

All admins share SQLite on Railway’s `/data` persistent volume. **OBS outputs** offers a full JSON backup and daily compressed recovery files. The daily file is refreshed every minute; 14 days are retained on the same volume. Download a copy outside Railway for independent recovery. Credentials and active publisher leases are excluded from exported backups.

Stop collection, choose a JSON or `.json.gz` backup, review its game/draft counts and click **Restore this backup**. Matching archives and controls are restored; unrelated saved games remain. The current state is backed up before restoring. Observer PCs must pair again if their original credential was lost; backup imports never create publisher access.

## Compact match overlay

Open **Match overlay** for the cream-and-olive in-game banner. Its permanent
OBS URL is **/obs/match-overlay**. Use a **1920 × 102** Browser Source at its
original size; a full 1920 × 1080 source also works with transparent space below.
The banner retains the compact half-height design and a 35px transparent live
hero-HUD region. The game's player portraits remain visible underneath.
The center stays empty until an operator uploads their own logo.

The default links follow the current tournament's displayed team names,
draft bans, broadcast series scores and event name. Statlocker and manual
draft updates use the same shared feed. Clearing a ban or starting another
draft clears the corresponding banner slot immediately. Banned heroes use
the bundled native critical-health (hurt) artwork. Publishing a winning result
also refreshes the linked score boxes in already-open OBS sources.

Choose **Best of 1** for one fillable score box per team, **Best of 3** for two,
or follow the existing broadcast format. Linked BO5/BO7 formats remain supported.
Choose a team-name font from Bodoni, Oswald, Georgia, Arial or Times New Roman.
The two custom fonts are bundled with their open-font licenses in public/fonts.

Turn off an individual link to edit names, bans, score boxes or the event name
independently. Switching to manual retains the currently displayed values.
Manual overlay edits do not change the source draft or global branding. The
same controls also manage tournament subtitles, sponsors, logos, team accents
and on-air visibility. Settings are shared between admins, saved per tournament,
included in backups and restored after restart. Changing tournaments keeps the
same OBS URL and shows the selected tournament's overlay.

**Background opacity** softens the banner artwork and name-box backgrounds
without fading names, scores, logos or banned-hero portraits. Try 85–90% first;
100% preserves the original appearance. The setting is saved per tournament.

Enable **Player name boxes** to place six clean labels above each team's live
hero portraits. Names follow the selected Live stats game, including its manual
player-name edits and portrait order. Swapping heroes in Live stats moves their
name boxes in the same update. Overlay-only custom names are keyed by player ID,
so they move with the player; **Use live name** restores the source name. With no
collector game selected, the loaded API stats roster is used when available.
Without game information, fill the twelve manual name slots instead.

Expand **Adjust name box placement** to align the row with your game HUD. The
default row fits the existing 1920 × 102 source. If moved lower, use the source
height shown beside the permanent URL, or a 1920 × 1080 source. Source changes
and tournament switches clear the previous roster instead of keeping old names.

## Brackets and reusable rosters

Open **Bracket** to manage a single-elimination tournament for 2–32 teams.
The **New tournament** form can include team names and up to six optional
players per team, with names and Steam accounts. Choose whether to save these
records for later tournaments. **Data library → Teams & players** also saves
individual players independently of a team and edits existing saved rosters.
SteamID64 strings, numeric account IDs and numeric Steam profile URLs are
accepted; vanity profile URLs require their numeric profile ID.

Arrange the teams in seed order, choose **By seed**, **Random draw** or
**Manual pairings**, then generate the bracket. Manual pairing matches adjacent
entries (1–2, 3–4, and so on). Byes advance automatically. Series formats BO1,
BO3, BO5 and BO7 are supported. Replacing a draw or changing its entrants after
results requires an explicit reset in the interface.

New draws offer separate early-round and final formats, defaulting to BO1 and
BO3. In an existing bracket, **Round formats** changes each unplayed round
without redrawing or changing its teams. The **BO1 rounds, BO3 final** preset
sets the common arrangement in one step. A round with recorded results keeps
its format until those results are cleared. Each match's score limits,
automatic advancement and prepared broadcast format follow its round.

The bracket display shows real fixtures only. Teams that advance automatically
start in their first actual match, with no team-versus-BYE cards. Internal
advancement and saved match identities stay intact for existing tournaments.

The **Draft studio** page also has a bracket-match selector. Choose a ready
match and **Start draft for selected match** to load its names, round and
format into a fresh manual board. An existing draft is saved first. Then
connect that match's Statlocker room, or make picks and bans manually. The
current live draft must be disconnected before starting a different match.

Use **Use this match on broadcast** before the series to load its team names,
logos, format and score into the broadcast controls. Confirm and publish each
completed game from **Live desk**. The bracket counts that game once and
advances the series winner only after the required wins. Replays, rehearsal
games, unrelated teams and duplicate captures cannot award bracket wins.
Editing an overlay score box does not finalize a bracket result. Manual bracket
scores and winners are also available; correcting an earlier winner resets the
affected downstream matches. Republishing an already-applied game with a
different winner asks the operator to correct that bracket result manually.

The permanent **/obs/bracket** Browser Source uses **1920 × 1080**. Enable
**Transparent background** to retain only the bracket, cards and text over the
scene below. Show/hide, results and tournament selection update the same URL.
Public bracket output contains team names, logos and results, with player
records and Steam accounts kept in the admin library. Brackets are saved per
tournament; the reusable team/player library is shared across tournaments.
Both are retained on the existing persistent volume and included in backups.
Restoring an older backup preserves the existing reusable library.

## Player introduction banners

Open **Player banners** to introduce both teams on a permanent **/obs/player-banners**
Browser Source at **1920 × 1080**. The screen contains two rows of six player
cards, team names and a central VS. Each card shows up to three most-played
heroes with exact tracked match counts and win rates. Optional rank badges sit
at the bottom of each card. Background transparency and show/hide are shared.

Choose **Follow broadcast teams** to use the tournament rosters matching the
current broadcast names, including side swaps. **Choose a bracket match** follows
that fixture's teams; **Manual rosters** lets you load saved teams or individual
players and edit display names and Steam accounts without changing the bracket.
Save manual edits before fetching. A blank display name uses the Steam name when
available. Keep reusable records in **Data library → Teams & players**.

Choose **Get statistics** after selecting the rosters. Cached data is reused for
15 minutes; **Refresh statistics** requests newer data after a one-minute cooldown.
The server batches up to twelve players, honors service retry delays and retains
last available statistics if a refresh fails. Missing or protected profiles are
shown as unavailable; no results or ranks are invented.

Statistics come from the [Deadlock API](https://api.deadlock-api.com/docs), using
its batch hero-stats, rank and Steam endpoints. Hero counts cover tracked normal
matches, ranked and unranked, without a time filter. Rank means the latest
Valve-reported badge available from the API, which may be unavailable or older
than a player's current game. It is not a predicted rank. Numeric Steam account
IDs, SteamID64 strings and numeric Steam profile URLs are accepted; vanity URLs
are not supported.

Settings and cached statistics are saved per tournament and included in backups.
The public OBS projection contains display names, team branding, hero aggregates
and optional rank artwork. Steam IDs, saved library records and service error
details stay in the admin workspace. An OBS viewer never triggers API requests.

## Permanent OBS outputs

| Output                         | Path                |
| ------------------------------ | ------------------- |
| Draft                          | /obs/draft          |
| Tournament bracket             | /obs/bracket        |
| Player introductions           | /obs/player-banners |
| Deadlock API stats             | /obs/live-events    |
| Deadem stats                   | /obs/deadem         |
| Reviewed post-match scoreboard | /obs/scoreboard     |
| Ultimate indicators            | /obs/ultimates      |
| Hero priority                  | /obs/hero-priority  |
| Top items                      | /obs/top-items      |
| Series MVP                     | /obs/series-mvp     |
| Compact match overlay          | /obs/match-overlay  |

Copy the full URLs from **OBS outputs**. Add each source at **1920 × 1080**. Match IDs, branding, statistics and HUD calibration are stored on the server; changing them does not change the URLs. The scoreboard follows the latest explicitly published result, even after another game is selected. Hide/show controls are shared.

OBS outputs are publicly readable; dashboard controls, saved-game archives and backups require the admin password. Enable **Control audio via OBS** for draft voice lines. Existing picks establish a silent baseline when a source reconnects.

## Operator workflow

1. Sign in. All admins use the same workspace.
2. Set team names, logos, series score, event and game number.
3. In **Draft studio**, connect a Statlocker link or use manual/demo mode. The backend sends spectator messages only; decisions remain in Statlocker. Private-room passwords stay in memory, never in URLs or saved snapshots.
4. In **Live desk**, pair the observer companion and start the local recording. The collapsed relay/replay fallback remains available for delayed collection. Legacy **API stats** is under Broadcast settings → Optional tools.
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

Do not use multiple replicas with this SQLite deployment. Horizontal scaling would need a shared database and collector coordination. Caster holding screens and highlights remain future roadmap work.

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

# Recording integrity and offline match data

Research checked on 2 November 2026. These findings describe available game
commands and recorded data. No full custom-lobby validation of disabling cheats
after starting a recording has been performed for this update.

## Recording with cheats

The current extracted Deadlock command list marks `record` and `_record` as
`cheat dontrecord release`. `stop` is a regular release command. The game describes
`sv_cheats` as allowing cheats on the server and marks it replicated; the private
lobby schema exposes one `cheats_enabled` setting. This supports treating it as a
server setting, not a permission granted only to the observer. No supported
per-player exception was identified in the inspected command and lobby schemas.

Primary game data:

- [Commands extracted from the game](https://github.com/SteamTracking/GameTracking-Deadlock/blob/master/DumpSource2/commands.txt).
- [Variables extracted from the game](https://github.com/SteamTracking/GameTracking-Deadlock/blob/master/DumpSource2/convars.txt).
- [Valve's private-lobby message schema](https://github.com/SteamTracking/Protobufs/blob/master/deadlock/citadel_gcmessages_common.proto).

The command flag establishes the requirement for invoking `record`; it does not
establish whether an already-started recording continues when cheats are disabled.
That needs a controlled rehearsal on the tournament's current game build. The
studio cannot enforce a server setting through a demo reader.

### Rehearse before selecting a tournament workflow

Use a separate private test lobby, with the host and a second participating player
available. Do not experiment with these changes during an event.

1. Note the game build and lobby settings. Join as the intended spectator and
   prepare a fresh recording in the companion before the countdown.
2. Enable cheats through the host's available controls and run the companion's
   generated `record ...` command in the observer's console. Confirm that the
   actual file and decoded twelve-player feed are advancing.
3. If the host can change the setting in that lobby, try `sv_cheats 0` in the host's
   authorized console. Query the setting on the host and a player's client. An
   unavailable command or permission denial is a failed test, not confirmation.
4. On the participating player's client, check that a harmless cheat-protected
   test command such as `noclip` is rejected. Reset the test lobby afterwards.
   Test the actual command restrictions needed for the event; a single rejection
   does not establish that all possible cheat functions are blocked.
5. Continue through a full match. Check file growth, increasing source ticks and
   twelve-player updates after disabling cheats; purchases, buffs and damage on
   both teams; and a real game-over signal followed by `stop`. Verify that the
   resulting file can be parsed from the start and compare final totals.
6. Rehearse observer reconnect/restart separately. A workflow that can continue
   an existing recording might still require cheats to begin another recording.
   Repeat after game/parser updates.

If those checks fail, keep the result recorded as unsupported for that build.
Options are a retrieved Valve replay/relay when available, or a separately
validated server setup under the organizer's control. The existence of `tv_record`
in the game command list does not demonstrate access to it on Valve-hosted lobbies.
Do not promise that this app can disable cheats for players while leaving them
enabled for an observer.

## Recorded console entries are partial evidence

The observer reader captures `DEM_ConsoleCmd` packets. Valve's
[`CDemoConsoleCmd` schema](https://github.com/SteamTracking/Protobufs/blob/master/deadlock/demo.proto)
contains `cmdstring` and provides no author/player field. A local demo is not a
server audit of every player's console. Commands may be omitted; the game command
list explicitly includes `dontrecord` flags.

The studio keeps the latest 500 recognized console entries, with source ticks and
up to 500 characters of command text. Shortened text is marked `truncated`.
Player attribution stays null. Unknown packet shapes are skipped instead of
being serialized into purported command evidence. There is no inferred clean-game
flag or automatic cheat verdict.

Use the operator-facing description: **Recorded console entries — partial and
unattributed. Missing entries do not prove fair play.** Preserve the original demo
for review. Observing an `sv_cheats` command string alone does not prove it executed
successfully or that the server's effective setting changed.

## Finished matches collected without a live tracker

A match does not have to be streamed to retrieve its finished metadata. The
[Deadlock API metadata endpoint](https://api.deadlock-api.com/openapi.json) accepts
the numeric match ID and supports `is_custom=true`. Retrieval depends on accessible
metadata/replay storage and Valve availability. Missing or expired files cannot be
reconstructed from an ID. Cache-first requests using `disable_steam=true` avoid
automatically consuming the API's more limited Steam fallback allowance.

The
[metadata handler](https://github.com/deadlock-api/deadlock-api/blob/master/api/src/routes/v1/matches/metadata.rs)
adds `pregame_hero_ids` (account ID to initially locked hero), `hero_build_ids`
(account ID to first selected build), and `banned_hero_ids` (a flat list), when demo
analysis is available. Empty additions can mean analysis was unavailable. Bans have
no banning team, pick/ban order or timestamp. The final twelve heroes do not
establish an external Statlocker draft sequence, especially after hero swaps.
Link an existing saved draft or enter the external draft separately; never invent
its order or assign bans to a team from this list.

The
[Valve metadata schema](https://github.com/SteamTracking/Protobufs/blob/master/deadlock/citadel_gcmessages_common.proto)
provides per-player sampled `stats` with `time_stamp_s`, `player_damage`,
`boss_damage`, `net_worth`, K/D/A and other optional values. These are recorded
samples, not a continuous event history. Use the most recent recorded sample at
or before a selected time. Do not fabricate samples or treat absent fields as zero.
Top-level final player K/D/A and net worth take precedence at game end.

`players[].items[]` includes `game_time_s`, `item_id`, `upgrade_id`,
`sold_time_s` and optional upgrade/imbue/flag fields. Match IDs against the item
catalogue to separate items from ability upgrades. These records support purchase
timings and observed sale timings, but do not alone establish a complete refund
audit. A recorded sale is not proof of either a full refund or a partial sale.
Retain source and coverage labels when combining metadata imports with live
purchase reports, and require operator review of ambiguous sale/refund records.

Souls-source samples can include `gold_sources` and legacy `gold_*` fields.
Do not sum both representations. Income by source, current cash, cumulative
income and net worth are different measures. A graph derived from net worth must
be labelled as net-worth difference or net-worth growth, rather than total souls
earned. Importing a record is not evidence that the operator wants it published
or counted toward a series/bracket result.

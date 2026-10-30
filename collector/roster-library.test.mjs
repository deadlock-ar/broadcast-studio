import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { BroadcastDatabase } from "./database.mjs";
import {
  RosterLibrary,
  normalizeSteamId,
  cleanRosterSnapshot,
} from "./roster-library.mjs";

async function setup(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "dlar-rosters-"));
  const store = new BroadcastDatabase(directory);
  await store.load();
  const library = new RosterLibrary(store);
  t.after(async () => {
    store.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { store, library, directory };
}

test("Steam identities normalize without rounding and reject vanity or unrelated URLs", () => {
  assert.equal(normalizeSteamId("12345"), "76561197960278073");
  assert.equal(normalizeSteamId(12345), "76561197960278073");
  assert.equal(normalizeSteamId("76561197960278073"), "76561197960278073");
  assert.equal(
    normalizeSteamId("https://steamcommunity.com/profiles/76561197960278073/"),
    "76561197960278073",
  );
  assert.equal(normalizeSteamId(" "), "");
  assert.equal(normalizeSteamId("4294967295"), "76561202255233023");
  for (const bad of [
    "0",
    "4294967296",
    "76561197960265728",
    "https://steamcommunity.com/id/name",
    "https://steamcommunity.com.evil.test/profiles/76561197960278073",
    "https://user@steamcommunity.com/profiles/76561197960278073",
    Number("76561197960278073"),
    {},
    "javascript:12345",
  ])
    assert.throws(() => normalizeSteamId(bad));
});

test("player records deduplicate Steam IDs, keep aliases unless explicitly edited, and persist independently", async (t) => {
  const { store, library } = await setup(t);
  const first = library.savePlayer({ name: "First player", steamId: "12345" });
  assert.equal(first.steamId, "76561197960278073");
  const reused = library.savePlayer({
    name: "Incoming alias",
    steamId: first.steamId,
  });
  assert.equal(reused.id, first.id);
  assert.equal(reused.name, "First player");
  const edited = library.savePlayer({ id: first.id, name: "Display name" });
  assert.equal(edited.steamId, first.steamId);
  assert.equal(edited.name, "Display name");
  const second = library.savePlayer({ name: "Display name" });
  assert.notEqual(second.id, first.id);
  assert.throws(() =>
    library.savePlayer({ id: second.id, steamId: first.steamId }),
  );
  store.workspace.activeTournamentId = randomUUID();
  assert.equal(
    new RosterLibrary(store).getPlayer(first.id).name,
    "Display name",
  );
  assert.equal(library.list("12345").players.length, 0);
  assert.equal(library.list(first.steamId).players.length, 1);
});

test("saving teams and inline players is atomic, bounded and reusable across names", async (t) => {
  const { library } = await setup(t);
  assert.throws(() =>
    library.saveTeam({
      name: "Invalid",
      savePlayers: true,
      players: [
        { name: "Valid", steamId: "20" },
        { name: "Invalid", steamId: "not-a-steam-account" },
      ],
    }),
  );
  assert.deepEqual(library.snapshot(), { version: 1, players: [], teams: [] });
  const team = library.saveTeam({
    name: "Team Alpha",
    tag: "A",
    savePlayers: true,
    players: [
      { name: "One", steamId: "20" },
      { name: "Two", steamId: "21" },
    ],
  });
  assert.equal(team.playerIds.length, 2);
  assert.deepEqual(
    library.resolveTeam(team.id).players.map((p) => p.name),
    ["One", "Two"],
  );
  assert.equal(library.saveTeam({ name: "TEAM ALPHA" }).id, team.id);
  assert.equal(library.list({ query: "one" }).teams[0].id, team.id);
  const before = library.snapshot();
  assert.throws(() =>
    library.saveTeam({
      id: team.id,
      playerIds: [team.playerIds[0], team.playerIds[0]],
    }),
  );
  assert.throws(() =>
    library.saveTeam({
      name: "Too many",
      savePlayers: true,
      players: Array.from({ length: 7 }, (_, i) => ({ name: `Player ${i}` })),
    }),
  );
  assert.throws(() =>
    library.saveTeam({ name: "Missing", playerIds: [randomUUID()] }),
  );
  assert.deepEqual(library.snapshot(), before);
  const renamed = library.saveTeam({ id: team.id, name: "Renamed Alpha" });
  assert.deepEqual(renamed.playerIds, team.playerIds);
});

test("roster backup merge remaps duplicate Steam identities and respects outer rollback", async (t) => {
  const { store, library } = await setup(t);
  const existing = library.savePlayer({ name: "Existing", steamId: "100" });
  const importedId = randomUUID();
  const input = {
    version: 1,
    players: [
      { id: importedId, name: "Older alias", steamId: existing.steamId },
    ],
    teams: [{ id: randomUUID(), name: "Restored", playerIds: [importedId] }],
  };
  const result = library.restore(input);
  assert.equal(result.library.players.length, 1);
  assert.equal(result.library.players[0].name, "Existing");
  assert.deepEqual(result.library.teams[0].playerIds, [existing.id]);
  store.db.exec("BEGIN IMMEDIATE");
  library.savePlayer({ name: "Rolled back", steamId: "101" });
  store.db.exec("ROLLBACK");
  assert.equal(library.snapshot().players.length, 1);
  assert.deepEqual(cleanRosterSnapshot(undefined), {
    version: 1,
    players: [],
    teams: [],
  });
  assert.throws(() =>
    cleanRosterSnapshot({
      ...input,
      teams: [{ ...input.teams[0], playerIds: [randomUUID()] }],
    }),
  );
});

test("restoring a duplicate player inside one team rolls back every imported record", async (t) => {
  const { library } = await setup(t);
  const one = randomUUID(),
    two = randomUUID();
  assert.throws(() =>
    library.restore({
      version: 1,
      players: [
        { id: one, name: "One", steamId: "222" },
        { id: two, name: "Two", steamId: "222" },
      ],
      teams: [{ id: randomUUID(), name: "Duplicate", playerIds: [one, two] }],
    }),
  );
  assert.deepEqual(library.snapshot(), { version: 1, players: [], teams: [] });
});

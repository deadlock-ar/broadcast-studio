import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { createBroadcastServer } from "./cloud-server.mjs";
import { exportBackup, prepareRestore } from "./backups.mjs";
import { cleanBracket } from "../src/bracket.js";

const entrants = (count = 4) =>
  Array.from({ length: count }, (_, index) => ({
    id: randomUUID(),
    name: `Team ${index + 1}`,
    players: [
      {
        id: randomUUID(),
        name: `Player ${index + 1}`,
        steamId: `https://steamcommunity.com/profiles/${76561197960266728n + BigInt(index)}/`,
      },
    ],
  }));

async function fixture(t) {
  const directory = await mkdtemp(
    path.join(tmpdir(), "dlar-bracket-persistence-"),
  );
  const web = path.join(directory, "web");
  await mkdir(web);
  await writeFile(
    path.join(web, "index.html"),
    "<main>Bracket persistence</main>",
  );
  const open = new Set();
  const start = async () => {
    const app = await createBroadcastServer({
      directory,
      staticDirectory: web,
      port: 0,
      origin: "http://bracket-persistence.test",
      password: "",
      hosted: false,
    });
    open.add(app);
    return app;
  };
  const close = async (app) => {
    await app.shutdown();
    open.delete(app);
  };
  t.after(async () => {
    for (const app of open) await app.shutdown();
    await rm(directory, { recursive: true, force: true });
  });
  return { directory, start, close, app: await start() };
}

const command = (app, action, value = {}) =>
  app.brackets.command(action, {
    ...value,
    expectedRevision: app.store.workspace.bracket.revision,
  });

test("older SQLite workspaces, tournaments and restored trash receive bracket defaults", async (t) => {
  const { app, directory, start, close } = await fixture(t);
  const first = app.store.workspace.activeTournamentId;
  const archived = app.store.tournaments.create({ name: "Legacy deleted cup" });
  app.store.tournaments.select(first);
  app.store.workspace.config.teams[0].name = "Preserved team";
  app.store.tournaments.trash("tournament", [archived.id]);
  const trashId = app.store.tournaments.listTrash()[0].id;
  await close(app);

  const legacy = new DatabaseSync(path.join(directory, "broadcast.sqlite"));
  const workspace = JSON.parse(
    legacy.prepare("SELECT value FROM settings WHERE key='workspace'").get()
      .value,
  );
  delete workspace.bracket;
  legacy
    .prepare("UPDATE settings SET value=? WHERE key='workspace'")
    .run(JSON.stringify(workspace));
  for (const row of legacy.prepare("SELECT id,value FROM tournaments").all()) {
    const record = JSON.parse(row.value);
    delete record.state.bracket;
    legacy
      .prepare("UPDATE tournaments SET value=? WHERE id=?")
      .run(JSON.stringify(record), row.id);
  }
  const oldTrash = JSON.parse(
    legacy.prepare("SELECT value FROM trash WHERE id=?").get(trashId).value,
  );
  delete oldTrash.record.state.bracket;
  legacy
    .prepare("UPDATE trash SET value=? WHERE id=?")
    .run(JSON.stringify(oldTrash), trashId);
  legacy.close();

  const restarted = await start();
  assert.deepEqual(restarted.store.workspace.bracket, cleanBracket());
  assert.equal(
    restarted.store.workspace.config.teams[0].name,
    "Preserved team",
  );
  for (const record of restarted.store.tournaments.records.values())
    assert.deepEqual(record.state.bracket, cleanBracket());
  const stored = JSON.parse(
    restarted.store.db
      .prepare("SELECT value FROM tournaments WHERE id=?")
      .get(first).value,
  );
  assert.deepEqual(stored.state.bracket, cleanBracket());
  restarted.store.tournaments.restore(trashId);
  restarted.store.tournaments.select(archived.id);
  assert.deepEqual(restarted.store.workspace.bracket, cleanBracket());
  assert.deepEqual(
    restarted.store.tournaments.records.get(archived.id).state.bracket,
    cleanBracket(),
  );
});

test("tournament creation normalizes optional players and saves reusable records only when requested", async (t) => {
  const { app } = await fixture(t);
  const first = app.store.tournaments.create({
    name: "Tournament-only roster",
    entrants: entrants(2),
    generate: true,
    seeding: "manual",
    seriesFormat: "BO1",
  });
  assert.equal(app.store.workspace.bracket.matches.length, 1);
  assert.equal(
    app.store.workspace.bracket.entrants[0].players[0].steamId,
    "76561197960266728",
  );
  assert.deepEqual(app.store.rosterLibrary.list(), { teams: [], players: [] });
  const reusable = entrants(2);
  reusable[1].players.push({ name: "Name without account" });
  const second = app.store.tournaments.create({
    name: "Reusable roster",
    entrants: reusable,
    saveToLibrary: true,
    generate: true,
    seriesFormat: "BO3",
  });
  const saved = app.store.rosterLibrary.snapshot();
  assert.equal(saved.teams.length, 2);
  assert.equal(saved.players.length, 3);
  assert.equal(
    saved.players.find((player) => player.name === "Name without account")
      .steamId,
    "",
  );
  app.store.tournaments.select(first.id);
  assert.equal(app.store.workspace.bracket.seriesFormat, "BO1");
  assert.equal(
    app.store.workspace.bracket.entrants[0].players[0].steamId,
    "76561197960266728",
  );
  assert.deepEqual(app.store.rosterLibrary.snapshot(), saved);
  app.store.tournaments.select(second.id);
  assert.equal(app.store.workspace.bracket.seriesFormat, "BO3");
  assert.equal(app.store.workspace.bracket.entrants[1].players.length, 2);
  assert.deepEqual(app.store.rosterLibrary.snapshot(), saved);
});

test("bracket results, display settings and the independent roster library survive server restart", async (t) => {
  const { app, start, close } = await fixture(t);
  const cup = app.store.tournaments.create({
    name: "Persistent cup",
    entrants: entrants(),
    generate: true,
    seeding: "manual",
    saveToLibrary: true,
  });
  command(app, "prepare", { matchId: "r1-m1" });
  command(app, "result", { matchId: "r1-m1", scores: [2, 1] });
  command(app, "settings", {
    transparent: true,
    visible: false,
    autoResults: false,
  });
  const before = structuredClone(app.store.workspace.bracket);
  const library = app.store.rosterLibrary.snapshot();
  const config = structuredClone(app.store.workspace.config);
  await close(app);
  const restarted = await start();
  assert.equal(restarted.store.workspace.activeTournamentId, cup.id);
  assert.deepEqual(restarted.store.workspace.bracket, before);
  assert.deepEqual(restarted.store.workspace.config, config);
  assert.deepEqual(restarted.store.rosterLibrary.snapshot(), library);
  assert.equal(
    restarted.store.workspace.bracket.matches[2].teamIds[0],
    before.entrants[0].id,
  );
});

test("backups preserve active, inactive and deleted brackets together with reusable rosters", async (t) => {
  const { app } = await fixture(t);
  const first = app.store.tournaments.create({
    name: "Archived bracket",
    entrants: entrants(),
    generate: true,
    seeding: "manual",
    saveToLibrary: true,
  });
  command(app, "result", { matchId: "r1-m1", scores: [2, 0] });
  const archivedBracket = structuredClone(app.store.workspace.bracket);
  const second = app.store.tournaments.create({
    name: "Inactive bracket",
    entrants: entrants(2),
    generate: true,
    seriesFormat: "BO1",
  });
  command(app, "settings", { transparent: true });
  const inactiveBracket = structuredClone(app.store.workspace.bracket);
  app.store.tournaments.create({
    name: "Active bracket",
    entrants: entrants(3),
    generate: true,
  });
  command(app, "settings", { visible: false });
  app.store.tournaments.trash("tournament", [first.id]);
  const backup = exportBackup(app.store);
  const prepared = prepareRestore(backup, app.store);
  assert.deepEqual(prepared.workspace.bracket, app.store.workspace.bracket);
  assert.deepEqual(
    prepared.tournaments.find((record) => record.id === second.id).state
      .bracket,
    inactiveBracket,
  );
  assert.deepEqual(prepared.trash[0].record.state.bracket, archivedBracket);
  assert.deepEqual(prepared.rosterLibrary, app.store.rosterLibrary.snapshot());
  assert.equal(backup.rosterLibrary.players[0].steamId, "76561197960266728");

  delete backup.workspace.bracket;
  delete backup.rosterLibrary;
  for (const record of backup.tournaments) delete record.state.bracket;
  for (const entry of backup.trash) delete entry.record.state.bracket;
  const existingLibrary = app.store.rosterLibrary.snapshot();
  const legacy = prepareRestore(backup, app.store);
  assert.deepEqual(legacy.workspace.bracket, cleanBracket());
  assert.ok(
    legacy.tournaments.every(
      (record) =>
        JSON.stringify(record.state.bracket) === JSON.stringify(cleanBracket()),
    ),
  );
  assert.deepEqual(legacy.trash[0].record.state.bracket, cleanBracket());
  assert.equal(legacy.rosterLibrary, null);
  assert.deepEqual(app.store.rosterLibrary.snapshot(), existingLibrary);
});

test("actual backup restore restores bracket state and an older backup preserves the current library", async (t) => {
  const { app } = await fixture(t);
  app.store.tournaments.create({
    name: "Restore bracket",
    entrants: entrants(2),
    generate: true,
    saveToLibrary: true,
  });
  command(app, "result", { matchId: "r1-m1", scores: [2, 0] });
  command(app, "settings", { transparent: true });
  const backup = exportBackup(app.store);
  const expected = structuredClone(app.store.workspace.bracket);
  const extra = app.store.rosterLibrary.savePlayer({
    name: "Saved after export",
    steamId: "2000",
  });
  command(app, "clear-result", { matchId: "r1-m1" });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const restore = async (data) => {
    const response = await fetch(base + "/api/backup/restore", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: app.origin },
      body: JSON.stringify(data),
    });
    assert.equal(
      response.status,
      200,
      JSON.stringify(await response.clone().json()),
    );
    assert.equal((await response.json()).restored, true);
  };
  await restore(backup);
  assert.deepEqual(app.store.workspace.bracket, expected);
  assert.equal(app.store.rosterLibrary.getPlayer(extra.id).name, extra.name);
  const library = app.store.rosterLibrary.snapshot();
  backup.rosterLibrary = null;
  delete backup.workspace.bracket;
  for (const record of backup.tournaments) delete record.state.bracket;
  await restore(backup);
  assert.deepEqual(app.store.workspace.bracket, cleanBracket());
  assert.deepEqual(app.store.rosterLibrary.snapshot(), library);
});

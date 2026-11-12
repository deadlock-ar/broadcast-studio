import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { BroadcastDatabase } from "./database.mjs";
import { Archive } from "./archive.mjs";
import { Tournaments } from "./tournaments.mjs";
import { createBroadcastServer } from "./cloud-server.mjs";
import { emptySession, applyFrame, publishResult } from "./model.mjs";
import { exportBackup, prepareRestore } from "./backups.mjs";
import { reportOutput } from "./reports.mjs";
import { cleanReportSettings } from "../src/analytics.js";

const players = () =>
  Array.from({ length: 12 }, (_, i) => ({
    id: String(100 + i),
    team: i < 6 ? 0 : 1,
    slot: i + 1,
    heroId: i + 1,
    damage: 100,
    kills: 1,
    deaths: 1,
    assists: 1,
    souls: 1000,
  }));
function game(store, id = "123") {
  const s = emptySession(id, "local");
  s.tournamentId = store.workspace.activeTournamentId;
  s.tournament = store.workspace.config.event;
  s.label = "Saved final";
  applyFrame(s, {
    players: players(),
    duration: 50,
    tick: 500,
    endObserved: true,
    winner: 0,
  });
  publishResult(s, { winner: 0 });
  store.sessions.set(id, s);
  store.save(s);
  return s;
}
async function database(t) {
  const dir = await mkdtemp(path.join(tmpdir(), "dlar-tournaments-"));
  const store = new BroadcastDatabase(dir);
  await store.load();
  store.archive = new Archive(store);
  t.after(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  return store;
}

test("legacy event labels migrate without losing games, drafts or current output settings", async (t) => {
  const store = await database(t);
  store.workspace.config.event = "Cup A";
  store.workspace.config.teams[0].score = 2;
  const a = game(store);
  delete a.tournamentId;
  const b = game(store, "456");
  b.tournament = "Cup B";
  delete b.tournamentId;
  store.workspace.draft.snapshot.steps[0].heroId = 1;
  store.archive.capture();
  store.tournaments = new Tournaments(store);
  assert.equal(store.tournaments.records.size, 2);
  assert.equal(store.workspace.config.teams[0].score, 2);
  assert.equal(a.tournamentId, store.workspace.activeTournamentId);
  assert.notEqual(a.tournamentId, b.tournamentId);
  assert.equal(store.archive.list()[0].tournamentId, a.tournamentId);
  const id = a.tournamentId;
  store.tournaments.rename(id, "Renamed cup");
  assert.equal(a.tournamentId, id);
  assert.equal(
    store.workspace.tournaments.find((r) => r.id === id).name,
    "Renamed cup",
  );
});

test("switching tournaments restores separate draft, branding, scores, manual MVP and report selections", async (t) => {
  const store = await database(t);
  store.tournaments = new Tournaments(store);
  const a = store.workspace.activeTournamentId;
  game(store);
  store.workspace.deadem.id = "123";
  store.workspace.scoreboard.matchId = "123";
  store.workspace.config.teams[0].score = 2;
  store.workspace.reports.selectedGames = ["123"];
  store.workspace.reports = cleanReportSettings({
    ...store.workspace.reports,
    mvpSource: "manual",
    manualMvp: { name: "Alpha MVP", heroId: 1, kills: 4, damage: 0 },
  });
  store.saveWorkspace();
  const b = store.tournaments.create("Cup B");
  assert.equal(store.workspace.deadem.id, "");
  assert.equal(store.workspace.config.teams[0].score, 0);
  assert.deepEqual(store.workspace.reports.selectedGames, []);
  store.workspace.config.teams[1].score = 1;
  store.saveWorkspace();
  store.tournaments.select(a);
  assert.equal(store.workspace.config.teams[0].score, 2);
  assert.equal(store.workspace.scoreboard.matchId, "123");
  assert.equal(store.workspace.reports.manualMvp.name, "Alpha MVP");
  assert.equal(
    reportOutput(store, "series-mvp", [{ id: 1 }], []).player.damage,
    0,
  );
  store.tournaments.select(b.id);
  assert.equal(store.workspace.config.teams[1].score, 1);
  assert.equal(
    reportOutput(store, "series-mvp", [{ id: 1 }], []).visible,
    false,
  );
});

test("renaming updates only the tournament's event labels and retains results and manual titles", async (t) => {
  const store = await database(t);
  store.tournaments = new Tournaments(store);
  const a = store.tournaments.create({
    name: "Cup A",
    entrants: [{ name: "Alpha" }, { name: "Omega" }],
    generate: true,
    seeding: "seeded",
  });
  const saved = game(store);
  saved.published.event = "Cup A";
  await store.save(saved);
  const custom = game(store, "789");
  custom.tournament = "Historic event label";
  custom.published.event = "Sponsor showcase";
  await store.save(custom);
  store.workspace.draft.snapshot.steps[0].heroId = 1;
  store.workspace.draft.snapshot.status = "COMPLETED";
  const draft = store.archive.capture({ label: "Opening game" });
  const b = store.tournaments.create("Cup B");
  // Equal text alone must never cause another tournament's records to change.
  store.workspace.config.event = "Cup A";
  const other = game(store, "456");
  other.published.event = "Cup A";
  await store.save(other);
  store.workspace.draft.snapshot.steps[0].heroId = 2;
  const otherDraft = store.archive.capture({ label: "Other opening" });
  store.tournaments.select(a.id);
  store.workspace.config.teams[0].score = 1;
  store.workspace.reports.titles.heroes = "Custom hero report";
  store.workspace.matchOverlay.links.event = false;
  store.workspace.matchOverlay.tournament.name = "Custom overlay";
  store.workspace.scoreboard.mvp = { title: "Custom award" };
  store.saveWorkspace();
  const bracket = structuredClone(store.workspace.bracket);
  const result = structuredClone(saved.result);
  store.tournaments.rename(a.id, "Renamed Cup A");
  assert.equal(store.workspace.config.event, "Renamed Cup A");
  assert.equal(a.state.config.event, "Renamed Cup A");
  assert.equal(saved.tournament, "Renamed Cup A");
  assert.equal(saved.published.event, "Renamed Cup A");
  assert.equal(saved.label, "Saved final");
  assert.equal(custom.tournament, "Historic event label");
  assert.equal(custom.published.event, "Sponsor showcase");
  assert.deepEqual(saved.result, result);
  assert.deepEqual(store.workspace.bracket, bracket);
  assert.equal(store.workspace.config.teams[0].score, 1);
  assert.equal(store.workspace.reports.titles.heroes, "Custom hero report");
  assert.equal(store.workspace.matchOverlay.tournament.name, "Custom overlay");
  assert.equal(store.workspace.matchOverlay.links.event, false);
  assert.equal(store.workspace.scoreboard.mvp.title, "Custom award");
  const archived = store.archive.list().find((item) => item.id === draft.id);
  assert.equal(archived.tournament, "Renamed Cup A");
  assert.equal(archived.config.event, "Renamed Cup A");
  assert.equal(archived.label, "Opening game");
  assert.equal(archived.completed, true);
  assert.deepEqual(archived.selections, draft.selections);
  assert.equal(other.tournament, "Cup A");
  assert.equal(other.published.event, "Cup A");
  assert.equal(
    store.archive.list().find((item) => item.id === otherDraft.id).tournament,
    "Cup A",
  );
  assert.equal(store.tournaments.records.get(b.id).name, "Cup B");
  const persisted = JSON.parse(
    store.db.prepare("SELECT value FROM matches WHERE id=?").get(saved.id)
      .value,
  );
  assert.equal(persisted.published.event, "Renamed Cup A");
});

test("inactive and same-name renames persist through selection and service restart", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "dlar-rename-restart-"));
  let store = new BroadcastDatabase(dir);
  const open = async () => {
    await store.load();
    store.archive = new Archive(store);
    store.tournaments = new Tournaments(store);
  };
  await open();
  t.after(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  const a = store.tournaments.create("Beat Pit Open qualifiers");
  const saved = game(store);
  saved.published.event = a.name;
  await store.save(saved);
  store.workspace.draft.snapshot.steps[0].heroId = 1;
  const draft = store.archive.capture();
  const b = store.tournaments.create("Cup B");
  store.workspace.config.teams[0].score = 2;
  store.saveWorkspace();
  // Reproduce a name already saved by the old implementation.
  a.name = "Bear Pit Open qualifiers";
  store.tournaments.put(a);
  store.tournaments.rename(a.id, a.name);
  assert.equal(store.workspace.activeTournamentId, b.id);
  assert.equal(store.workspace.config.event, "Cup B");
  assert.equal(store.workspace.config.teams[0].score, 2);
  assert.equal(a.state.config.event, "Bear Pit Open qualifiers");
  assert.equal(saved.published.event, "Bear Pit Open qualifiers");
  store.tournaments.select(a.id);
  assert.equal(store.workspace.config.event, "Bear Pit Open qualifiers");
  store.tournaments.select(b.id);
  store.close();
  store = new BroadcastDatabase(dir);
  await open();
  assert.equal(store.workspace.config.event, "Cup B");
  store.tournaments.select(a.id);
  assert.equal(store.workspace.config.event, "Bear Pit Open qualifiers");
  assert.equal(
    store.sessions.get(saved.id).tournament,
    "Bear Pit Open qualifiers",
  );
  assert.equal(
    store.archive.list().find((item) => item.id === draft.id).config.event,
    "Bear Pit Open qualifiers",
  );
  assert.throws(() => store.tournaments.rename(a.id, "Cup B"), /different/);
  assert.equal(store.workspace.config.event, "Bear Pit Open qualifiers");
});

test("rename rollback keeps tournament, workspace and saved event labels consistent", async (t) => {
  const store = await database(t);
  store.tournaments = new Tournaments(store);
  const record = store.tournaments.create("Cup A"),
    saved = game(store);
  saved.published.event = record.name;
  await store.save(saved);
  store.workspace.draft.snapshot.steps[0].heroId = 1;
  const draft = store.archive.capture();
  store.saveWorkspace();
  const revision = store.workspace.revision;
  store.db.exec(`CREATE TRIGGER reject_rename BEFORE UPDATE ON drafts
    BEGIN SELECT RAISE(ABORT, 'Archive write failed'); END;`);
  assert.throws(
    () => store.tournaments.rename(record.id, "New Cup A"),
    /Archive write failed/,
  );
  assert.equal(record.name, "Cup A");
  assert.equal(store.workspace.config.event, "Cup A");
  assert.equal(store.workspace.revision, revision);
  assert.equal(saved.published.event, "Cup A");
  assert.equal(store.read("workspace").config.event, "Cup A");
  assert.equal(
    JSON.parse(
      store.db
        .prepare("SELECT value FROM tournaments WHERE id=?")
        .get(record.id).value,
    ).name,
    "Cup A",
  );
  assert.equal(
    store.archive.list().find((item) => item.id === draft.id).tournament,
    "Cup A",
  );
});

test("HTTP rename refreshes the event used by each linked broadcast output", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "dlar-rename-http-"));
  const app = await createBroadcastServer({
    directory: dir,
    port: 0,
    origin: "http://studio.test",
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await app.shutdown();
    await rm(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${app.server.address().port}`,
    id = app.store.workspace.activeTournamentId;
  const response = await fetch(base + "/api/tournaments/rename", {
    method: "POST",
    headers: {
      Origin: app.origin,
      "Content-Type": "application/json",
      "X-DLAR-Tournament": id,
    },
    body: JSON.stringify({ id, name: "Bear Pit Open qualifiers" }),
  });
  assert.equal(response.status, 200);
  assert.equal(
    (await response.json()).config.event,
    "Bear Pit Open qualifiers",
  );
  const output = async (channel) =>
    (await fetch(base + "/api/broadcast?channel=" + channel)).json();
  assert.equal(
    (await output("draft")).config.event,
    "Bear Pit Open qualifiers",
  );
  assert.equal(
    (await output("bracket")).bracket.title,
    "Bear Pit Open qualifiers",
  );
  assert.equal(
    (await output("match-overlay")).overlay.tournament.name,
    "Bear Pit Open qualifiers",
  );
  assert.equal(
    (await output("casters")).stage.event,
    "Bear Pit Open qualifiers",
  );
});

test("deleting and restoring a game cleans outputs and report selections without recalculating series scores", async (t) => {
  const store = await database(t);
  store.tournaments = new Tournaments(store);
  game(store);
  store.workspace.deadem.id = "123";
  store.workspace.scoreboard.matchId = "123";
  store.workspace.reports.selectedGames = ["123"];
  store.workspace.config.teams[0].score = 1;
  store.saveWorkspace();
  store.tournaments.trash("game", ["123"]);
  assert.equal(store.tournaments.isDeleted("123"), true);
  assert.equal(store.sessions.has("123"), false);
  assert.equal(store.workspace.scoreboard.matchId, "");
  assert.deepEqual(store.workspace.reports.selectedGames, []);
  assert.equal(store.workspace.config.teams[0].score, 1);
  const entry = store.tournaments.listTrash()[0];
  store.tournaments.restore(entry.id);
  assert.equal(store.tournaments.isDeleted("123"), false);
  assert.equal(store.sessions.get("123").published.match.players.length, 12);
  assert.equal(store.workspace.scoreboard.matchId, "");
  store.tournaments.trash("game", ["123"]);
  const id = store.tournaments.listTrash()[0].id;
  assert.throws(() => store.tournaments.purge(id, "yes"));
  store.tournaments.purge(id, "DELETE");
  assert.equal(store.tournaments.listTrash().length, 0);
});

test("tournament deletion bundles its records and backups retain every tournament, manual value and trash entry", async (t) => {
  const store = await database(t);
  store.tournaments = new Tournaments(store);
  const a = store.workspace.activeTournamentId;
  game(store);
  store.workspace.draft.snapshot.steps[0].heroId = 1;
  store.archive.capture();
  assert.throws(
    () => store.tournaments.trash("tournament", [a]),
    /Select another/,
  );
  const b = store.tournaments.create("Cup B");
  store.tournaments.trash("tournament", [a]);
  assert.equal(store.sessions.size, 0);
  assert.equal(store.archive.list().length, 0);
  const backup = exportBackup(store),
    restored = prepareRestore(backup, store);
  assert.equal(restored.tournaments[0].id, b.id);
  assert.equal(restored.trash[0].games[0].published.match.players.length, 12);
  assert.equal(restored.workspace.activeTournamentId, b.id);
  store.tournaments.restore(store.tournaments.listTrash()[0].id);
  store.tournaments.select(a);
  assert.equal(store.sessions.size, 1);
  assert.equal(store.archive.list().length, 1);
});

test("HTTP rejects stale tournament edits, filters live desk games and blocks switching during active recording", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "dlar-tournament-http-"));
  const app = await createBroadcastServer({
    directory: dir,
    port: 0,
    origin: "http://studio.test",
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await app.shutdown();
    await rm(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const post = async (route, value, scope) => {
    const r = await fetch(base + "/api/" + route, {
      method: "POST",
      headers: {
        Origin: app.origin,
        "Content-Type": "application/json",
        ...(scope ? { "X-DLAR-Tournament": scope } : {}),
      },
      body: JSON.stringify(value),
    });
    return { status: r.status, data: await r.json() };
  };
  const a = app.store.workspace.activeTournamentId;
  assert.equal(
    (await post("workspace", { id: randomUUID(), operations: [] })).status,
    409,
  );
  game(app.store);
  const b = await post("tournaments/create", { name: "Cup B" }, a);
  assert.equal(b.status, 200);
  const bid = b.data.activeTournamentId;
  const old = await post("workspace", { id: randomUUID(), operations: [] }, a);
  assert.equal(old.status, 409);
  const list = await (await fetch(base + "/api/collector/health")).json();
  assert.equal(list.games.length, 0);
  assert.equal(
    (
      await post(
        "workspace",
        {
          id: randomUUID(),
          tournamentId: bid,
          operations: [{ path: ["deadem", "id"], before: "", value: "123" }],
        },
        bid,
      )
    ).status,
    400,
  );
  const code = app.publisher.issue(),
    p = app.publisher.pair(code, "test"),
    identity = app.publisher.authenticate({
      headers: { authorization: `Bearer ${p.token}` },
    }),
    id = "local-" + randomUUID();
  const lease = app.publisher.begin(identity, { id });
  app.publisher.ingest(identity, {
    ...lease,
    sequence: 1,
    frame: { tick: 1, duration: 1, players: players() },
  });
  assert.equal((await post("tournaments/select", { id: a }, bid)).status, 409);
  app.publisher.revoke(p.publisherId);
  assert.equal((await post("tournaments/select", { id: a }, bid)).status, 200);
  assert.throws(() => app.publisher.begin(identity, { id }), /tournament/);
});

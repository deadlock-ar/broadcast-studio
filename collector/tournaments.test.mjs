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

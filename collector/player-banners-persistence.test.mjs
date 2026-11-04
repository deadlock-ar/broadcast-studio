import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { createBroadcastServer } from "./cloud-server.mjs";
import { exportBackup, prepareRestore } from "./backups.mjs";
import { cleanPlayerBanners } from "../src/player-banners.js";

const steam = (id) => String(76561197960265728n + BigInt(id));
const roster = (first = 1001) =>
  [0, 1].map((index) => ({
    id: randomUUID(),
    name: `Banner team ${first + index}`,
    tag: `T${index + 1}`,
    players: [
      {
        id: randomUUID(),
        name: `Player ${first + index}`,
        steamId: String(first + index),
      },
    ],
  }));

async function fixture(t, { password = "" } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "dlar-player-banners-"));
  const web = path.join(directory, "web");
  await mkdir(web);
  await writeFile(
    path.join(web, "index.html"),
    "<main>Player banner output</main>",
  );
  const opened = new Set();
  const requests = [];
  const now = () => 2000000000;
  const fetcher = async (address) => {
    requests.push(address);
    const url = new URL(address);
    assert.equal(url.origin, "https://api.deadlock-api.com");
    const accounts = url.searchParams.get("account_ids").split(",").map(Number);
    const rows = url.pathname.endsWith("/hero-stats")
      ? accounts.flatMap((id) => [
          { account_id: id, hero_id: 1, matches_played: 100, wins: 64 },
          { account_id: id, hero_id: 2, matches_played: 50, wins: 25 },
        ])
      : url.pathname.endsWith("/rank")
        ? accounts.map((id) => ({
            account_id: id,
            badge: 115,
            rank: 11,
            subrank: 5,
            last_match: { match_id: 42 },
          }))
        : accounts.map((id) => ({
            account_id: id,
            personaname: `Private cached alias ${id}`,
          }));
    return new Response(JSON.stringify(rows), {
      headers: { "Content-Type": "application/json" },
    });
  };
  const start = async () => {
    const app = await createBroadcastServer({
      directory,
      staticDirectory: web,
      port: 0,
      origin: "http://player-banners.test",
      password,
      hosted: false,
      playerBannersOptions: { fetch: fetcher, now },
    });
    opened.add(app);
    return app;
  };
  const close = async (app) => {
    await app.shutdown();
    opened.delete(app);
  };
  t.after(async () => {
    for (const app of opened) await app.shutdown();
    await rm(directory, { recursive: true, force: true });
  });
  return { directory, start, close, requests, app: await start() };
}

async function listen(app) {
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${app.server.address().port}`;
}

function configure(app, teams = roster()) {
  app.store.workspace.playerBanners = cleanPlayerBanners({
    source: "manual",
    transparent: true,
    showRanks: true,
    teams,
  });
  app.store.saveWorkspace();
}

const post = (base, app, route, value = {}, headers = {}) =>
  fetch(base + route, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: app.origin,
      ...headers,
    },
    body: JSON.stringify(value),
  });

test("banner settings and successful player statistics survive restart and stay isolated by tournament", async (t) => {
  const { app, start, close, requests } = await fixture(t);
  const firstId = app.store.workspace.activeTournamentId;
  configure(app);
  await app.playerBanners.refresh();
  const first = structuredClone(app.store.workspace.playerBanners);
  assert.equal(first.profiles[steam(1001)].heroes[0].matches, 100);
  assert.equal(first.profiles[steam(1001)].rank.name, "Eternus V");
  assert.equal(requests.length, 3);
  const second = app.store.tournaments.create({ name: "Second banner cup" });
  assert.deepEqual(app.store.workspace.playerBanners, cleanPlayerBanners());
  configure(app, roster(2001));
  await app.playerBanners.refresh();
  const secondState = structuredClone(app.store.workspace.playerBanners);
  assert.equal(secondState.profiles[steam(1001)], undefined);
  app.store.tournaments.select(firstId);
  assert.deepEqual(app.store.workspace.playerBanners, first);
  await close(app);
  const restarted = await start();
  assert.equal(restarted.store.workspace.activeTournamentId, firstId);
  assert.deepEqual(restarted.store.workspace.playerBanners, first);
  restarted.store.tournaments.select(second.id);
  assert.deepEqual(restarted.store.workspace.playerBanners, secondState);
  assert.equal(
    requests.length,
    6,
    "restarts and switching do not query external services",
  );
});

test("backups restore active, inactive and deleted banner settings and older backups receive safe defaults", async (t) => {
  const { app } = await fixture(t);
  const firstId = app.store.workspace.activeTournamentId;
  configure(app);
  await app.playerBanners.refresh();
  const first = structuredClone(app.store.workspace.playerBanners);
  const deleted = app.store.tournaments.create({ name: "Deleted banner cup" });
  configure(app, roster(2001));
  app.store.workspace.playerBanners.showRanks = false;
  app.store.saveWorkspace();
  const deletedState = structuredClone(app.store.workspace.playerBanners);
  const active = app.store.tournaments.create({ name: "Active banner cup" });
  configure(app, roster(3001));
  app.store.workspace.playerBanners.visible = false;
  app.store.saveWorkspace();
  const activeState = structuredClone(app.store.workspace.playerBanners);
  app.store.tournaments.trash("tournament", [deleted.id]);
  const backup = exportBackup(app.store);
  const prepared = prepareRestore(backup, app.store);
  assert.deepEqual(prepared.workspace.playerBanners, activeState);
  assert.deepEqual(
    prepared.tournaments.find((record) => record.id === firstId).state
      .playerBanners,
    first,
  );
  assert.deepEqual(prepared.trash[0].record.state.playerBanners, deletedState);
  const base = await listen(app);
  app.store.workspace.playerBanners.transparent = false;
  app.store.workspace.playerBanners.profiles = {};
  app.store.saveWorkspace();
  const restored = await post(base, app, "/api/backup/restore", backup);
  assert.equal(restored.status, 200, await restored.text());
  assert.deepEqual(app.store.workspace.playerBanners, activeState);
  assert.equal(app.store.workspace.activeTournamentId, active.id);

  delete backup.workspace.playerBanners;
  for (const record of backup.tournaments) delete record.state.playerBanners;
  for (const entry of backup.trash) delete entry.record.state.playerBanners;
  const legacy = prepareRestore(backup, app.store);
  assert.deepEqual(legacy.workspace.playerBanners, cleanPlayerBanners());
  for (const record of legacy.tournaments)
    assert.deepEqual(record.state.playerBanners, cleanPlayerBanners());
  assert.deepEqual(
    legacy.trash[0].record.state.playerBanners,
    cleanPlayerBanners(),
  );
  const restoredLegacy = await post(base, app, "/api/backup/restore", backup);
  assert.equal(restoredLegacy.status, 200, await restoredLegacy.text());
  assert.deepEqual(app.store.workspace.playerBanners, cleanPlayerBanners());
});

test("legacy SQLite workspaces, tournaments and restored deleted tournaments gain banner defaults without losing branding", async (t) => {
  const { app, directory, start, close } = await fixture(t);
  const firstId = app.store.workspace.activeTournamentId;
  app.store.workspace.config.teams[0].name = "Preserved branding";
  const deleted = app.store.tournaments.create({
    name: "Legacy deleted banner cup",
  });
  app.store.tournaments.select(firstId);
  app.store.tournaments.trash("tournament", [deleted.id]);
  const trashId = app.store.tournaments.listTrash()[0].id;
  await close(app);
  const db = new DatabaseSync(path.join(directory, "broadcast.sqlite"));
  const w = JSON.parse(
    db.prepare("SELECT value FROM settings WHERE key='workspace'").get().value,
  );
  delete w.playerBanners;
  db.prepare("UPDATE settings SET value=? WHERE key='workspace'").run(
    JSON.stringify(w),
  );
  for (const row of db.prepare("SELECT id,value FROM tournaments").all()) {
    const record = JSON.parse(row.value);
    delete record.state.playerBanners;
    db.prepare("UPDATE tournaments SET value=? WHERE id=?").run(
      JSON.stringify(record),
      row.id,
    );
  }
  const trash = JSON.parse(
    db.prepare("SELECT value FROM trash WHERE id=?").get(trashId).value,
  );
  delete trash.record.state.playerBanners;
  db.prepare("UPDATE trash SET value=? WHERE id=?").run(
    JSON.stringify(trash),
    trashId,
  );
  db.close();
  const restarted = await start();
  assert.deepEqual(
    restarted.store.workspace.playerBanners,
    cleanPlayerBanners(),
  );
  assert.equal(
    restarted.store.workspace.config.teams[0].name,
    "Preserved branding",
  );
  for (const record of restarted.store.tournaments.records.values())
    assert.deepEqual(record.state.playerBanners, cleanPlayerBanners());
  restarted.store.tournaments.restore(trashId);
  restarted.store.tournaments.select(deleted.id);
  assert.deepEqual(
    restarted.store.workspace.playerBanners,
    cleanPlayerBanners(),
  );
});

test("public banner output exposes only display data and the permanent OBS page remains public", async (t) => {
  const { app } = await fixture(t, { password: "player-banner-test-password" });
  configure(app);
  await app.playerBanners.refresh();
  const state = app.store.workspace.playerBanners;
  state.profiles[steam(1001)].status = "error";
  state.profiles[steam(1001)].error = "Private retry diagnostic";
  const base = await listen(app);
  const response = await fetch(base + "/api/broadcast?channel=player-banners");
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(Object.keys(payload), ["banners"]);
  assert.equal(payload.banners.teams[0].players[0].name, "Player 1001");
  assert.equal(payload.banners.teams[0].players[0].heroes[0].winRate, 64);
  assert.equal(payload.banners.teams[0].players[0].rank.name, "Eternus V");
  const serialized = JSON.stringify(payload);
  for (const forbidden of [
    "steamId",
    steam(1001),
    "profiles",
    "fetchedAt",
    "Private cached alias",
    "Private retry diagnostic",
  ])
    assert.equal(serialized.includes(forbidden), false, forbidden);
  const output = await fetch(base + "/obs/player-banners");
  assert.equal(output.status, 200);
  assert.match(await output.text(), /Player banner output/);
  assert.equal(
    (await post(base, app, "/api/player-banners/refresh")).status,
    401,
  );
});

test("banner refresh and optimistic edits require the current tournament and protect service-owned cached statistics", async (t) => {
  const { app, requests } = await fixture(t, {
    password: "player-banner-test-password",
  });
  configure(app);
  const base = await listen(app);
  const login = await post(base, app, "/api/login", {
    password: "player-banner-test-password",
  });
  assert.equal(login.status, 200);
  const Cookie = login.headers.get("set-cookie").split(";")[0];
  assert.equal(
    (await post(base, app, "/api/player-banners/refresh", {}, { Cookie }))
      .status,
    409,
  );
  assert.equal(
    (
      await post(
        base,
        app,
        "/api/player-banners/refresh",
        {},
        { Cookie, "X-DLAR-Tournament": randomUUID() },
      )
    ).status,
    409,
  );
  assert.equal(requests.length, 0);
  const headers = {
    Cookie,
    "X-DLAR-Tournament": app.store.workspace.activeTournamentId,
  };
  const refreshed = await post(
    base,
    app,
    "/api/player-banners/refresh",
    {},
    headers,
  );
  assert.equal(refreshed.status, 200, await refreshed.text());
  assert.equal(requests.length, 3);
  const profileBefore = structuredClone(
    app.store.workspace.playerBanners.profiles,
  );
  const patch = (operations) =>
    post(
      base,
      app,
      "/api/workspace",
      {
        id: randomUUID(),
        tournamentId: app.store.workspace.activeTournamentId,
        operations,
      },
      headers,
    );
  const forbidden = await patch([
    { path: ["playerBanners", "profiles"], before: profileBefore, value: {} },
  ]);
  assert.equal(forbidden.status, 400);
  assert.deepEqual(app.store.workspace.playerBanners.profiles, profileBefore);
  const beforeTeams = structuredClone(app.store.workspace.playerBanners.teams);
  const afterTeams = structuredClone(beforeTeams);
  afterTeams[0].players[0].name = "Manual on-air alias";
  const changed = await patch([
    { path: ["playerBanners", "showRanks"], before: true, value: false },
    {
      path: ["playerBanners", "teams"],
      before: beforeTeams,
      value: afterTeams,
    },
  ]);
  assert.equal(changed.status, 200, await changed.text());
  assert.equal(app.store.workspace.playerBanners.showRanks, false);
  assert.equal(
    app.store.workspace.playerBanners.teams[0].players[0].name,
    "Manual on-air alias",
  );
  assert.deepEqual(app.store.workspace.playerBanners.profiles, profileBefore);
  const stale = await patch([
    { path: ["playerBanners", "showRanks"], before: true, value: true },
  ]);
  assert.equal(stale.status, 409);
  assert.equal(app.store.workspace.playerBanners.showRanks, false);
});

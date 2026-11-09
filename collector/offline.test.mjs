import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { importedMatch, OfflineImporter, soulsBySource } from "./offline.mjs";
import { createBroadcastServer } from "./cloud-server.mjs";
import { reportOutput } from "./reports.mjs";
import { exportBackup, prepareRestore } from "./backups.mjs";
import { diffFields } from "../src/workspace-model.js";
import { playersAt, metricSupported } from "../src/stats.js";

const raw = JSON.parse(
  await readFile(
    new URL("../tests/offline-metadata.fixture.json", import.meta.url),
  ),
);
const items = JSON.parse(
  await readFile(new URL("./data/items.json", import.meta.url)),
);

test("real metadata subset imports twelve anonymized players, measured history and item evidence without inventing holdings", () => {
  const s = importedMatch(raw, "120513539", items, 123);
  assert.equal(s.match.players.length, 12);
  assert.equal(s.result.match.duration, 2525);
  assert.equal(
    s.match.players.reduce((n, p) => n + p.damage, 0),
    651398,
  );
  assert.equal(s.match.telemetry.points.length, 3);
  assert.equal(s.match.telemetry.points[0].time, 180);
  assert.ok(s.match.telemetry.points.every((p) => p.teams?.length === 2));
  assert.ok(s.match.players.some((p) => p.objectiveDamage > 0));
  assert.ok(s.items.purchases.length > 0);
  assert.ok(
    s.items.purchases.every(
      (p) => p.status === "recorded" && items.some((i) => i.id === p.itemId),
    ),
  );
  assert.ok(
    s.match.players.every((p) => p.items === null && p.abilities === null),
  );
  assert.equal(s.offline.unassignedBans, null);
  assert.equal(s.items.reviewCount, 0);
  assert.equal(s.items.reportBasis, "recorded-item-picks");
  assert.equal(s.published, null);
  assert.equal(playersAt(s.match).length, 12);
  assert.equal(metricSupported("objectiveDamage", s.match), true);
  assert.throws(() => importedMatch(raw, "123", items), /different match/);
  const partial = structuredClone(raw);
  partial.match_info.players.pop();
  assert.throws(
    () => importedMatch(partial, "120513539", items),
    /twelve-player/,
  );
});
test("metadata context keeps unknown draft order explicit, and partial souls income is not a complete total", () => {
  const data = structuredClone(raw);
  data.banned_hero_ids = [1, 2];
  data.pregame_hero_ids = { 1: 99 };
  const s = importedMatch(data, "120513539", items);
  assert.equal(s.offline.pregameHeroes["1"], 99);
  assert.deepEqual(s.offline.unassignedBans, [1, 2]);
  assert.equal(s.offline.draftOrderKnown, false);
  assert.equal(s.draftArchiveId, undefined);
  assert.deepEqual(
    soulsBySource({
      gold_player: 9000,
      gold_sources: [
        { source: 1, gold: 50, gold_orbs: 10 },
        { source: 2, gold: 100 },
      ],
    }),
    [
      { source: 1, label: "Players", gold: 60, knownGold: 60, complete: true },
      {
        source: 2,
        label: "Troopers",
        gold: null,
        knownGold: 100,
        complete: false,
      },
    ],
  );
  assert.equal(soulsBySource({}), null);
});

async function fixture(t, load = async () => structuredClone(raw)) {
  const directory = await mkdtemp(path.join(tmpdir(), "dlar-offline-"));
  const app = await createBroadcastServer({
    directory,
    port: 0,
    origin: "http://offline.test",
    password: "test-offline-password",
    hosted: true,
    loadOfflineMetadata: load,
  });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  t.after(async () => {
    await app.shutdown();
    await rm(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const login = await fetch(base + "/api/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://offline.test",
    },
    body: JSON.stringify({ password: "test-offline-password" }),
  });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const post = (route, body, headers = {}) =>
    fetch(base + "/api/" + route, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://offline.test",
        Cookie: cookie,
        "X-DLAR-Tournament": app.store.workspace.activeTournamentId,
        ...headers,
      },
      body: JSON.stringify(body),
    });
  const get = (route) =>
    fetch(base + "/api/" + route, { headers: { Cookie: cookie } });
  return { app, base, post, get };
}
test("off-stream HTTP import protects access, persists archives and leaves live selection, scores and publication intact", async (t) => {
  const { app, base, post, get } = await fixture(t);
  const selected = app.store.workspace.deadem.id,
    published = app.store.workspace.scoreboard.matchId;
  const scores = app.store.workspace.config.teams.map((p) => p.score);
  assert.equal(
    (await post("data/import-match", { id: "120513539" }, { Cookie: "" }))
      .status,
    401,
  );
  assert.equal(
    (
      await post(
        "data/import-match",
        { id: "120513539" },
        { "X-DLAR-Tournament": "stale" },
      )
    ).status,
    409,
  );
  const response = await post("data/import-match", { id: "120513539" });
  assert.equal(response.status, 200);
  const saved = await response.json();
  assert.equal(saved.players, 12);
  assert.equal(app.store.workspace.deadem.id, selected);
  assert.equal(app.store.workspace.scoreboard.matchId, published);
  assert.deepEqual(
    app.store.workspace.config.teams.map((p) => p.score),
    scores,
  );
  assert.ok(
    app.store.db.prepare("SELECT id FROM matches WHERE id=?").get("120513539"),
  );
  assert.equal(saved.draftId, null);
  assert.equal(app.store.archive.list().length, 0);
  assert.equal(
    (await post("data/import-match", { id: "120513539" })).status,
    400,
  );
  const publicResult = await (
    await fetch(base + "/api/broadcast?channel=scoreboard")
  ).json();
  assert.equal(publicResult.scoreboard, null);
  const legacy = app.store.sessions.get("120513539");
  for (const purchase of legacy.items.purchases) purchase.status = "review";
  const analytics = await (await get("analytics")).json();
  const imported = analytics.games.find((game) => game.id === legacy.id);
  assert.equal(imported.reportBasis, "recorded-item-picks");
  assert.equal(imported.reviewCount, 0);
  assert.ok(imported.purchases.length > 0);
  assert.ok(
    imported.purchases.every((purchase) => purchase.status === "recorded"),
  );
  assert.ok(
    legacy.items.purchases.every((purchase) => purchase.status === "review"),
  );
});
test("imports fence a changed tournament, concurrent duplicate requests and captures saved under local IDs", async (t) => {
  const { app } = await fixture(t);
  let release;
  const waiting = new Promise((resolve) => {
    release = resolve;
  });
  const importer = new OfflineImporter(app.store, items, () => waiting);
  const importing = importer.import({ id: "120513539" });
  await assert.rejects(
    importer.import({ id: "120513539" }),
    /already being imported/,
  );
  app.store.tournaments.create({ name: "Different tournament" });
  release(structuredClone(raw));
  await assert.rejects(importing, /Tournament changed/);
  assert.equal(app.store.sessions.size, 0);
  const local = importedMatch(raw, "120513539", items);
  local.id = `local-${randomUUID()}`;
  app.store.sessions.set(local.id, local);
  await assert.rejects(importer.import({ id: "120513539" }), /already saved/);
});
test("caster settings survive tournament/backup persistence and public output excludes the protected Discord URL", async (t) => {
  const { app, post, base } = await fixture(t);
  const before = structuredClone(app.store.workspace.casterStage);
  const stage = {
    ...before,
    title: "The night desk",
    layout: "discord",
    source: "manual",
    teams: [
      { name: "Orange", score: 2, logo: "https://teams.test/orange.png" },
      { name: "Blue", score: 1, logo: "" },
    ],
    discordUrl:
      "https://streamkit.discord.com/overlay/voice/123456789012345678/234567890123456789",
  };
  const result = await post("workspace", {
    id: randomUUID(),
    tournamentId: app.store.workspace.activeTournamentId,
    operations: diffFields(before, stage, ["casterStage"]),
  });
  assert.equal(result.status, 200);
  const output = await (
    await fetch(base + "/api/broadcast?channel=casters")
  ).json();
  assert.equal(output.stage.title, "The night desk");
  assert.deepEqual(
    output.stage.teams.map((team) => team.score),
    [2, 1],
  );
  assert.equal(output.stage.teams[0].logo, stage.teams[0].logo);
  assert.equal(JSON.stringify(output).includes("streamkit.discord.com"), false);
  const tournamentId = app.store.workspace.activeTournamentId;
  app.store.tournaments.create({ name: "Other show" });
  assert.notEqual(app.store.workspace.casterStage.title, "The night desk");
  app.store.tournaments.select(tournamentId);
  assert.equal(app.store.workspace.casterStage.title, "The night desk");
  assert.deepEqual(app.store.workspace.casterStage.teams, stage.teams);
  const backup = exportBackup(app.store),
    restored = prepareRestore(backup, app.store);
  assert.equal(restored.workspace.casterStage.discordUrl, stage.discordUrl);
  assert.deepEqual(restored.workspace.casterStage.teams, stage.teams);
  assert.equal(
    restored.tournaments.find((p) => p.id === tournamentId).state.casterStage
      .title,
    stage.title,
  );
});
test("existing metadata used as a comparison reports automatic picks and identifies their refund coverage", () => {
  const saved = importedMatch(raw, "120513539", items);
  for (const purchase of saved.items.purchases) purchase.status = "review";
  const good = structuredClone(saved);
  good.id = "2";
  good.items.purchases = [];
  const store = {
    workspace: {
      reports: { selectedGames: ["2"], comparisonGames: [saved.id] },
    },
    sessions: new Map([
      [saved.id, saved],
      [good.id, good],
    ]),
    archive: { list: () => [] },
  };
  const report = reportOutput(store, "top-items", [], items);
  assert.equal(report.visible, true);
  assert.equal(report.baselineGames, 1);
  assert.equal(report.reportBasis, "recorded-item-picks");
  assert.match(report.coverage, /full refunds are not identified/);
  assert.ok(saved.items.purchases.every((p) => p.status === "review"));
});

test("known empty item arrays are complete zero counts, while absent item history stays partial", () => {
  const complete = structuredClone(raw);
  complete.match_info.players[0].items = [];
  assert.equal(
    importedMatch(complete, "120513539", items).items.fromStart,
    true,
  );
  delete complete.match_info.players[0].items;
  assert.equal(
    importedMatch(complete, "120513539", items).items.fromStart,
    false,
  );
});

test("automatic metadata reports still block unresolved live transaction reviews", () => {
  const saved = importedMatch(raw, "120513539", items);
  const live = {
    id: "live-game",
    mode: "local",
    result: saved.result,
    items: {
      fromStart: true,
      purchases: [{ itemId: items[0].id, status: "review" }],
    },
  };
  const store = {
    workspace: { reports: { selectedGames: [saved.id, live.id] } },
    sessions: new Map([
      [saved.id, saved],
      [live.id, live],
    ]),
    archive: { list: () => [] },
  };
  const report = reportOutput(store, "top-items", [], items);
  assert.equal(report.visible, false);
  assert.equal(report.reportBasis, "recorded-item-picks");
  assert.equal(live.items.purchases[0].status, "review");
});

test("import only records catalog purchases after time zero and preserves sale and component evidence", () => {
  const data = structuredClone(raw);
  const itemId = items[0].id;
  data.match_info.players[0].items = [
    { item_id: itemId, game_time_s: 0 },
    { item_id: itemId, game_time_s: 10, upgrade_info: 8388608 },
    { item_id: itemId, game_time_s: 20, sold_time_s: 21, flags: 1 },
    { item_id: 123, game_time_s: 30 },
    { item_id: itemId, game_time_s: 40, sold_time_s: 80, upgrade_info: 131072 },
  ];
  const session = importedMatch(data, "120513539", items);
  const playerId = session.match.players[0].id;
  const purchases = session.items.purchases.filter(
    (p) => p.playerId === playerId,
  );
  assert.deepEqual(
    purchases.map((p) => p.gameTime),
    [20, 40],
  );
  assert.deepEqual(
    purchases.map((p) => p.soldTime),
    [21, 80],
  );
  assert.equal(purchases[0].flags, 1);
  assert.equal(purchases[1].upgradeInfo, 131072);
  assert.ok(purchases.every((p) => p.status === "recorded"));
});

test("only genuine saved drafts can be linked or selected after older metadata rosters exist", async (t) => {
  const { app, get, post } = await fixture(t);
  app.store.workspace.draft.mode = "manual";
  app.store.workspace.draft.snapshot.steps[0].heroId = 1;
  const draft = app.store.archive.capture({ label: "Saved actual draft" });
  const metadata = {
    ...structuredClone(draft),
    id: "metadata:legacy:120513539",
    source: "metadata",
    rule: "metadata-final-roster",
    selections: Array.from({ length: 12 }, () => ({
      heroId: 1,
      selectionType: "pick",
      firstRound: null,
      orderKnown: false,
    })),
  };
  app.store.db
    .prepare("INSERT INTO drafts VALUES (?,?)")
    .run(metadata.id, JSON.stringify(metadata));
  const analytics = await (await get("analytics")).json();
  const library = await (await get("data")).json();
  assert.deepEqual(
    analytics.drafts.map((d) => d.id),
    [draft.id],
  );
  assert.deepEqual(
    library.drafts.map((d) => d.id),
    [draft.id],
  );
  app.store.workspace.reports.selectedDrafts = [metadata.id, draft.id];
  app.store.workspace.reports.includeZero = false;
  const report = reportOutput(
    app.store,
    "hero-priority",
    [{ id: 1, name: "Hero one" }],
    [],
  );
  assert.equal(report.games, 1);
  assert.equal(report.rows[0].total, 1);
  assert.equal(
    (await post("data/import-match", { id: "120513539", draftId: metadata.id }))
      .status,
    400,
  );
  const linked = await post("data/import-match", {
    id: "120513539",
    draftId: draft.id,
  });
  assert.equal(linked.status, 200);
  assert.equal((await linked.json()).draftId, draft.id);
  assert.equal(app.store.sessions.get("120513539").draftArchiveId, draft.id);
  assert.equal(
    app.store.archive.list().length,
    2,
    "Legacy evidence remains in backups without entering draft reports",
  );
});

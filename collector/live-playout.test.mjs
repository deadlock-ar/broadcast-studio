import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  cleanLiveDelay,
  liveDelayMs,
  cleanPersistentHud,
  livePresentationSettings,
  rememberLiveSettings,
} from "./live-playout.mjs";
import {
  initialWorkspace,
  patchWorkspace,
  diffFields,
} from "../src/workspace-model.js";
import { emptySession, cleanSettings } from "./model.mjs";
import {
  enqueueCollectorState,
  collectorRenderNow,
  visibleUltimateBadges,
} from "../src/collector.js";
import { createBroadcastServer } from "./cloud-server.mjs";
import { exportBackup, prepareRestore } from "./backups.mjs";

test("one bounded target overrides game delays, including an explicit zero", () => {
  assert.equal(cleanLiveDelay(-1), 0);
  assert.equal(cleanLiveDelay(999999), 120000);
  assert.equal(cleanLiveDelay("5000"), null);
  const w = initialWorkspace(),
    s = { settings: { delayMs: 5000 } };
  assert.equal(liveDelayMs(w, s), 5000);
  w.deadem.delayMs = 0;
  assert.equal(liveDelayMs(w, s), 0);
  w.deadem.delayMs = 7000;
  assert.equal(liveDelayMs(w, s), 7000);
});

test("legacy migration recovers a saved calibration without borrowing another tournament or fight baseline", () => {
  const a = initialWorkspace(),
    b = initialWorkspace();
  a.deadem.id = "new";
  const current = {
    id: "new",
    tournamentId: "a",
    updatedAt: 30,
    settings: cleanSettings({
      ultimateBadges: { iconSize: 40 },
      names: { 1: "Current name" },
    }),
  };
  const old = {
    id: "old",
    tournamentId: "a",
    updatedAt: 20,
    settings: cleanSettings({
      hud: { x: 350, y: 130, gap: 25, teamGap: 215 },
      hudOrder: ["1"],
      delayMs: 5000,
    }),
  };
  const foreign = {
    id: "foreign",
    tournamentId: "b",
    updatedAt: 999,
    settings: cleanSettings({ hud: { x: 20 }, delayMs: 11000 }),
  };
  const records = new Map([
    ["a", { id: "a", state: a }],
    ["b", { id: "b", state: b }],
  ]);
  const store = {
    workspace: { ...a, activeTournamentId: "a" },
    sessions: new Map([current, old, foreign].map((s) => [s.id, s])),
    tournaments: { records, put() {} },
    saveWorkspace() {},
  };
  rememberLiveSettings(store);
  assert.equal(store.workspace.deadem.hudSettings.hud.x, 350);
  assert.equal(store.workspace.deadem.hudSettings.hud.y, 130);
  assert.equal(store.workspace.deadem.delayMs, 5000);
  assert.equal(store.workspace.deadem.hudSettings.ultimateBadges.iconSize, 40);
  assert.deepEqual(store.workspace.deadem.hudSettings.names, {
    1: "Current name",
  });
  assert.ok(
    !Object.hasOwn(store.workspace.deadem.hudSettings, "metricsBaseline"),
  );
  a.deadem.hudSettings = cleanPersistentHud({ hud: { x: 99 } });
  a.deadem.delayMs = 0;
  rememberLiveSettings(store);
  assert.equal(store.workspace.deadem.hudSettings.hud.x, 99);
  assert.equal(store.workspace.deadem.delayMs, 0);
});

test("persistent preferences apply to every game while its own baseline stays separate", () => {
  const w = initialWorkspace();
  w.deadem.delayMs = 5000;
  w.deadem.hudSettings = cleanPersistentHud({
    hud: { x: 350 },
    ultimateBadges: { maxPerPlayer: 2 },
  });
  for (const id of ["1", "2"]) {
    const s = emptySession(id);
    const result = livePresentationSettings(w, s);
    assert.equal(result.hud.x, 350);
    assert.equal(result.delayMs, 5000);
    assert.equal(result.ultimateBadges.maxPerPlayer, 2);
    assert.equal(result.metricsBaseline, null);
    assert.equal(s.settings.hud.x, 460);
  }
});

test("live output payloads share a target and retain ultimates, bridge buffs and stats; preferences survive backup and restart", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "dlar-playout-"));
  const web = path.join(directory, "web");
  await mkdir(web);
  await writeFile(path.join(web, "index.html"), "<main>test</main>");
  const open = new Set();
  const start = async () => {
    const app = await createBroadcastServer({
      directory,
      staticDirectory: web,
      origin: "http://playout.test",
      password: "",
      hosted: false,
    });
    open.add(app);
    await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
    return app;
  };
  const close = async (app) => {
    await app.shutdown();
    open.delete(app);
  };
  t.after(async () => {
    for (const app of open) await app.shutdown();
    assert.ok(directory.startsWith(path.join(tmpdir(), "dlar-playout-")));
    await rm(directory, { recursive: true, force: true });
  });
  let app = await start();
  let base = `http://127.0.0.1:${app.server.address().port}`;
  const s = emptySession("9001");
  s.tournamentId = app.store.workspace.activeTournamentId;
  s.status = "live";
  s.updatedAt = 10000;
  s.sourceTiming = {
    basis: "recording-timeline",
    timelineId: "one",
    sourceAt: 10000,
  };
  s.match = {
    id: s.id,
    duration: 20,
    players: [
      {
        id: "1",
        team: 0,
        slot: 0,
        heroId: 1,
        kills: 12,
        souls: 12000,
        damage: 5000,
        healing: 100,
        bridgeBuffs: [{ id: 1, label: "Gun", remaining: 20 }],
      },
    ],
  };
  s.effects = [{ targetId: "1", abilityId: 2981692841, kind: "effect" }];
  s.recentHits = [
    {
      targetId: "1",
      abilityId: 2981692841,
      kind: "hit",
      at: 10000,
      durationMs: 1600,
    },
  ];
  await app.store.save(s);
  app.store.sessions.set(s.id, s);
  const next = structuredClone(app.store.workspace.deadem);
  next.id = s.id;
  next.delayMs = 5000;
  next.hudVisible = true;
  next.hudSettings = cleanPersistentHud({ hud: { x: 350, y: 130 } });
  app.store.applyPatch(
    randomUUID(),
    patchWorkspace(
      app.store.workspace,
      diffFields(app.store.workspace.deadem, next, ["deadem"]),
    ),
  );
  app.store.workspace.apiStats.source = { id: "9001", mode: "live" };
  app.store.workspace.apiStats.result = {
    status: "live",
    updated: 10000,
    match: s.match,
  };
  for (const channel of ["deadem", "ultimates", "momentum", "live-events"]) {
    const packet = await fetch(base + "/api/broadcast?channel=" + channel).then(
      (r) => r.json(),
    );
    assert.equal(packet.session.settings.delayMs, 5000);
    packet.session.sourceTiming = {
      ...packet.session.sourceTiming,
      sentAt: 10000,
      ...(channel !== "live-events" ? { sourceAt: 10000 } : {}),
    };
    const queue = enqueueCollectorState(
      [],
      packet,
      20000,
      packet.session.settings.delayMs,
    );
    assert.equal(queue[0].at, 25000);
    assert.equal(collectorRenderNow(queue[0].value.session, 25000), 10000);
    if (channel === "ultimates") {
      assert.equal(packet.session.match.players[0].bridgeBuffs.length, 1);
      assert.equal(
        visibleUltimateBadges(queue[0].value.session, 10000).length,
        1,
      );
    } else if (channel !== "live-events")
      assert.equal(packet.session.match.players[0].kills, 12);
  }
  const restored = prepareRestore(exportBackup(app.store), app.store);
  assert.equal(restored.workspace.deadem.delayMs, 5000);
  assert.equal(restored.workspace.deadem.hudSettings.hud.x, 350);
  const selected = app.store.workspace.activeTournamentId;
  const other = app.store.tournaments.create({
    name: "Other delay tournament",
  });
  assert.notEqual(other.id, selected);
  app.store.tournaments.select(selected);
  assert.equal(app.store.workspace.deadem.delayMs, 5000);
  assert.equal(app.store.workspace.deadem.hudSettings.hud.x, 350);
  await close(app);
  app = await start();
  base = `http://127.0.0.1:${app.server.address().port}`;
  const output = await fetch(base + "/api/broadcast?channel=ultimates").then(
    (r) => r.json(),
  );
  assert.equal(output.hudSettings.hud.x, 350);
  assert.equal(output.hudSettings.delayMs, 5000);
  assert.equal((await fetch(base + "/obs/ultimates?test=1")).status, 200);
});

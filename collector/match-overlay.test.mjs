import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { BroadcastDatabase } from "./database.mjs";
import { Archive } from "./archive.mjs";
import { Tournaments } from "./tournaments.mjs";
import { exportBackup, prepareRestore } from "./backups.mjs";
import { createBroadcastServer } from "./cloud-server.mjs";
import { emptySession, applyFrame } from "./model.mjs";
import {
  cleanMatchOverlay,
  resolveMatchOverlay,
} from "../src/match-overlay.js";
import {
  initialWorkspace,
  blankDraft,
  diffFields,
  patchWorkspace,
  OUTPUTS,
} from "../src/workspace-model.js";

async function database(t) {
  const dir = await mkdtemp(path.join(tmpdir(), "dlar-match-overlay-"));
  const store = new BroadcastDatabase(dir);
  await store.load();
  store.archive = new Archive(store);
  t.after(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  return store;
}

test("match overlay settings merge independent edits and reject stale edits", () => {
  const first = initialWorkspace();
  const visible = structuredClone(first.matchOverlay);
  visible.visible = false;
  const font = structuredClone(first.matchOverlay);
  font.font = "arial";
  const updated = patchWorkspace(
    first,
    diffFields(first.matchOverlay, visible, ["matchOverlay"]),
  );
  const merged = patchWorkspace(
    updated,
    diffFields(first.matchOverlay, font, ["matchOverlay"]),
  );
  assert.equal(merged.matchOverlay.visible, false);
  assert.equal(merged.matchOverlay.font, "arial");
  assert.throws(
    () =>
      patchWorkspace(merged, [
        { path: ["matchOverlay", "visible"], before: true, value: false },
      ]),
    (error) => error.status === 409,
  );
  const sanitized = patchWorkspace(merged, [
    { path: ["matchOverlay", "font"], before: "arial", value: "unsafe-font" },
    { path: ["matchOverlay", "privateToken"], before: null, value: "secret" },
  ]);
  assert.deepEqual(
    sanitized.matchOverlay,
    cleanMatchOverlay(sanitized.matchOverlay),
  );
  assert.equal("privateToken" in sanitized.matchOverlay, false);
});

test("SQLite adds defaults to an older workspace and retains new match overlay edits", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "dlar-overlay-migration-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const legacy = new BroadcastDatabase(dir);
  await legacy.load();
  delete legacy.workspace.matchOverlay;
  legacy.workspace.config.event = "Existing event";
  legacy.saveWorkspace();
  legacy.close();
  const migrated = new BroadcastDatabase(dir);
  await migrated.load();
  assert.deepEqual(migrated.workspace.matchOverlay, cleanMatchOverlay());
  assert.deepEqual(
    migrated.read("workspace").matchOverlay,
    cleanMatchOverlay(),
  );
  assert.equal(migrated.workspace.config.event, "Existing event");
  const next = patchWorkspace(migrated.workspace, [
    { path: ["matchOverlay", "visible"], before: true, value: false },
    {
      path: ["matchOverlay", "font"],
      before: migrated.workspace.matchOverlay.font,
      value: "arial",
    },
  ]);
  migrated.applyPatch(randomUUID(), next);
  assert.equal(migrated.workspace.matchOverlay.visible, false);
  migrated.close();
  const restarted = new BroadcastDatabase(dir);
  await restarted.load();
  assert.equal(restarted.workspace.matchOverlay.visible, false);
  assert.equal(restarted.workspace.matchOverlay.font, "arial");
  restarted.close();
});

test("tournaments isolate overlay settings and older tournament/trash snapshots gain defaults", async (t) => {
  const store = await database(t);
  store.tournaments = new Tournaments(store);
  const first = store.workspace.activeTournamentId;
  store.workspace.matchOverlay.visible = false;
  store.workspace.matchOverlay.font = "arial";
  store.saveWorkspace();
  const second = store.tournaments.create("Separate cup");
  assert.deepEqual(store.workspace.matchOverlay, cleanMatchOverlay());
  store.workspace.matchOverlay.font = "georgia";
  store.saveWorkspace();
  store.tournaments.select(first);
  assert.equal(store.workspace.matchOverlay.visible, false);
  assert.equal(store.workspace.matchOverlay.font, "arial");
  store.tournaments.select(second.id);
  assert.equal(store.workspace.matchOverlay.font, "georgia");

  const older = store.tournaments.records.get(first);
  delete older.state.matchOverlay;
  // Simulate an existing database tournament written before this setting existed.
  store.db
    .prepare("UPDATE tournaments SET value=? WHERE id=?")
    .run(JSON.stringify(older), first);
  store.tournaments = new Tournaments(store);
  assert.deepEqual(
    store.tournaments.records.get(first).state.matchOverlay,
    cleanMatchOverlay(),
  );
  assert.deepEqual(
    JSON.parse(
      store.db.prepare("SELECT value FROM tournaments WHERE id=?").get(first)
        .value,
    ).state.matchOverlay,
    cleanMatchOverlay(),
  );
  store.tournaments.trash("tournament", [first]);
  const entry = store.tournaments.listTrash()[0];
  delete entry.record.state.matchOverlay;
  store.db
    .prepare("UPDATE trash SET value=? WHERE id=?")
    .run(JSON.stringify(entry), entry.id);
  store.tournaments.restore(entry.id);
  store.tournaments.select(first);
  assert.deepEqual(store.workspace.matchOverlay, cleanMatchOverlay());
});

test("backups preserve overlay settings and normalize missing sections throughout old archives", async (t) => {
  const store = await database(t);
  store.tournaments = new Tournaments(store);
  const first = store.workspace.activeTournamentId;
  store.workspace.matchOverlay.font = "arial";
  store.workspace.matchOverlay.visible = false;
  store.saveWorkspace();
  store.tournaments.create("Other cup");
  store.tournaments.trash("tournament", [first]);
  const backup = exportBackup(store);
  const restored = prepareRestore(backup, store);
  assert.equal(restored.trash[0].record.state.matchOverlay.font, "arial");
  assert.equal(restored.trash[0].record.state.matchOverlay.visible, false);
  assert.deepEqual(restored.workspace.matchOverlay, cleanMatchOverlay());
  delete backup.workspace.matchOverlay;
  for (const record of backup.tournaments) delete record.state.matchOverlay;
  for (const entry of backup.trash) delete entry.record.state.matchOverlay;
  const old = prepareRestore(backup, store);
  assert.deepEqual(old.workspace.matchOverlay, cleanMatchOverlay());
  assert.deepEqual(old.tournaments[0].state.matchOverlay, cleanMatchOverlay());
  assert.deepEqual(old.trash[0].record.state.matchOverlay, cleanMatchOverlay());
});

test("match overlay has a permanent public output, protected edits, and draft SSE updates", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "dlar-overlay-http-"));
  const staticDirectory = path.join(dir, "web");
  await mkdir(staticDirectory);
  await writeFile(
    path.join(staticDirectory, "index.html"),
    "<main>Studio</main>",
  );
  const app = await createBroadcastServer({
    directory: dir,
    staticDirectory,
    port: 0,
    origin: "http://overlay.test",
    password: "overlay-test-admin-password",
    hosted: true,
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const abort = new AbortController();
  t.after(async () => {
    abort.abort();
    await app.shutdown();
    await rm(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const post = (route, value, cookie = "") =>
    fetch(base + route, {
      method: "POST",
      headers: {
        Origin: app.origin,
        "Content-Type": "application/json",
        "X-DLAR-Tournament": app.store.workspace.activeTournamentId,
        Cookie: cookie,
      },
      body: JSON.stringify(value),
    });
  const edit = {
    id: randomUUID(),
    operations: [
      {
        path: ["matchOverlay", "font"],
        before: app.store.workspace.matchOverlay.font,
        value: "arial",
      },
    ],
  };
  assert.equal((await post("/api/workspace", edit)).status, 401);
  const login = await post("/api/login", {
    password: "overlay-test-admin-password",
  });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  assert.equal((await post("/api/workspace", edit, cookie)).status, 200);
  const output = await (
    await fetch(base + "/api/broadcast?channel=match-overlay")
  ).json();
  assert.deepEqual(Object.keys(output), ["overlay"]);
  assert.equal(output.overlay.font, "arial");
  assert.deepEqual(output.overlay, resolveMatchOverlay(app.store.workspace));
  assert.equal("matchOverlay" in output, false);
  assert.equal("draft" in output, false);
  assert.equal("tournaments" in output.overlay, false);
  const fixedOutputs = {
    draft: "/obs/draft",
    "live-events": "/obs/live-events",
    deadem: "/obs/deadem",
    scoreboard: "/obs/scoreboard",
    ultimates: "/obs/ultimates",
    "hero-priority": "/obs/hero-priority",
    "top-items": "/obs/top-items",
    "series-mvp": "/obs/series-mvp",
    "match-overlay": "/obs/match-overlay",
  };
  assert.deepEqual(OUTPUTS, fixedOutputs);
  for (const [channel, url] of Object.entries(fixedOutputs)) {
    assert.equal((await fetch(base + url)).status, 200);
    assert.equal(
      (await fetch(base + "/api/broadcast?channel=" + channel)).status,
      200,
    );
  }

  // Exercise the real live feed callbacks without contacting a remote draft room.
  const sockets = [];
  const originalSocket = globalThis.WebSocket;
  globalThis.WebSocket = class {
    constructor() {
      sockets.push(this);
    }
    send() {}
    close() {
      this.onclose?.();
    }
    receive(snapshot) {
      this.onmessage?.({
        data: JSON.stringify({
          type: "DRAFT_STATE_UPDATE",
          draftState: snapshot,
        }),
      });
    }
  };
  t.after(() => {
    globalThis.WebSocket = originalSocket;
  });
  assert.equal(
    (
      await post(
        "/api/draft/connect",
        { mode: "live", code: "OVERLAY1" },
        cookie,
      )
    ).status,
    200,
  );
  const stream = await fetch(
    base + "/api/broadcast/events?channel=match-overlay",
    { signal: abort.signal },
  );
  assert.equal(stream.status, 200);
  const reader = stream.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  const nextEvent = async () => {
    const timeout = setTimeout(() => abort.abort(), 5000);
    try {
      while (!pending.includes("\n\n")) {
        const chunk = await reader.read();
        assert.equal(chunk.done, false);
        pending += decoder.decode(chunk.value, { stream: true });
      }
      const boundary = pending.indexOf("\n\n");
      const frame = pending.slice(0, boundary);
      pending = pending.slice(boundary + 2);
      return JSON.parse(frame.slice("data: ".length));
    } finally {
      clearTimeout(timeout);
    }
  };
  assert.deepEqual(await nextEvent(), output);
  const snapshot = blankDraft();
  snapshot.draftCode = "OVERLAY1";
  snapshot.steps[0].heroId = 1;
  snapshot.ownerToken = "private-owner-token";
  sockets[0].onopen();
  sockets[0].receive(snapshot);
  // A feed status event precedes the new clean snapshot.
  await nextEvent();
  const filled = await nextEvent();
  assert.deepEqual(filled, {
    overlay: resolveMatchOverlay(app.store.workspace),
  });
  assert.equal(filled.overlay.teams[0].bans[0], 1);
  assert.equal(JSON.stringify(filled).includes("private-owner-token"), false);
  snapshot.steps[0].heroId = null;
  sockets[0].receive(snapshot);
  await nextEvent();
  const cleared = await nextEvent();
  assert.equal(cleared.overlay.teams[0].bans[0], null);
  assert.deepEqual(cleared.overlay.teams[0].bans, [null, null, null]);

  const hide = {
    id: randomUUID(),
    operations: [
      { path: ["matchOverlay", "visible"], before: true, value: false },
    ],
  };
  assert.equal((await post("/api/workspace", hide, cookie)).status, 200);
  assert.equal((await nextEvent()).overlay.visible, false);

  const result = emptySession("123", "local");
  result.tournamentId = app.store.workspace.activeTournamentId;
  applyFrame(result, {
    players: Array.from({ length: 12 }, (_, index) => ({
      id: String(index + 1),
      slot: index,
      team: index < 6 ? 0 : 1,
      heroId: 1,
    })),
    duration: 120,
    endObserved: true,
    winner: 0,
  });
  app.store.sessions.set(result.id, result);
  assert.equal(
    (
      await post(
        "/api/collector/publish?match=123",
        { ...app.store.workspace.config, winner: 0 },
        cookie,
      )
    ).status,
    200,
  );
  assert.equal(app.store.workspace.config.teams[0].score, 1);
  const awarded = await nextEvent();
  assert.deepEqual(awarded.overlay.teams[0].scoreBoxes, [
    true,
    false,
    false,
    false,
  ]);
  assert.deepEqual(awarded.overlay.teams[1].scoreBoxes, [
    false,
    false,
    false,
    false,
  ]);
});

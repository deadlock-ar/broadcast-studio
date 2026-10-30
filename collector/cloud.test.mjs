import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { createBroadcastServer } from "./cloud-server.mjs";
import { BroadcastDatabase } from "./database.mjs";
import { SharedFeeds } from "./feeds.mjs";
import { AdminAuth } from "./auth.mjs";
import { emptySession, applyFrame } from "./model.mjs";
import {
  initialWorkspace,
  diffFields,
  patchWorkspace,
  OUTPUTS,
} from "../src/workspace-model.js";

test("edits to different branding fields merge; stale edits to the same field conflict", () => {
  const first = initialWorkspace(),
    a = structuredClone(first.config),
    b = structuredClone(first.config);
  a.teams[0].name = "Amber club";
  b.teams[1].name = "Sapphire club";
  const updated = patchWorkspace(
    first,
    diffFields(first.config, a, ["config"]),
  );
  const combined = patchWorkspace(
    updated,
    diffFields(first.config, b, ["config"]),
  );
  assert.equal(combined.config.teams[0].name, "Amber club");
  assert.equal(combined.config.teams[1].name, "Sapphire club");
  const stale = structuredClone(a);
  stale.teams[0].name = "Unexpected overwrite";
  assert.throws(
    () => patchWorkspace(combined, diffFields(first.config, stale, ["config"])),
    (e) => e.status === 409,
  );
});
test("workspace writes cannot inject feed results, passwords or prototype keys", () => {
  const w = initialWorkspace();
  for (const key of ["result", "source", "password"])
    assert.throws(() =>
      patchWorkspace(w, [{ path: ["apiStats", key], value: {}, before: null }]),
    );
  assert.throws(() =>
    patchWorkspace(w, [
      { path: ["config", "__proto__", "polluted"], value: true, before: null },
    ]),
  );
  w.draft.mode = "live";
  assert.throws(() =>
    patchWorkspace(w, diffFields(w.draft.snapshot, {}, ["draft", "snapshot"])),
  );
  assert.equal({}.polluted, undefined);
});
test("invalid draft inputs preserve an existing spectator connection", () => {
  const store = { workspace: initialWorkspace(), saveWorkspace() {} };
  const feeds = new SharedFeeds(store, () => {});
  let stops = 0;
  feeds.draft = () => stops++;
  assert.throws(() => feeds.connectDraft({ mode: "live", code: "invalid" }));
  assert.equal(stops, 0);
});
test("SQLite retains the active selection, branding and published result across restart", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "dlar-db-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new BroadcastDatabase(dir);
  await store.load();
  const next = structuredClone(store.workspace);
  next.config.event = "Saved cup";
  next.deadem.id = "123";
  next.scoreboard.matchId = "123";
  next.revision++;
  store.applyPatch(randomUUID(), next);
  const state = emptySession("123");
  state.published = { label: "on air" };
  await store.save(state);
  store.close();
  const recovered = new BroadcastDatabase(dir);
  await recovered.load();
  assert.equal(recovered.workspace.config.event, "Saved cup");
  assert.equal(recovered.workspace.deadem.id, "123");
  assert.deepEqual(recovered.sessions.get("123").published, {
    label: "on air",
  });
  assert.equal(recovered.sessions.get("123").status, "interrupted");
  recovered.close();
});
test("cloud HTTP protects admin writes, shares edits and keeps all five output URLs fixed", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "dlar-http-"));
  const staticDirectory = path.join(dir, "web");
  await mkdir(staticDirectory);
  await writeFile(
    path.join(staticDirectory, "index.html"),
    "<main>Broadcast Studio</main>",
  );
  const opts = {
    directory: dir,
    staticDirectory,
    port: 0,
    origin: "http://studio.example",
    password: "a-test-password-for-cloud",
    hosted: true,
  };
  const app = await createBroadcastServer(opts);
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  t.after(async () => {
    await app.shutdown();
    await rm(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const post = (route, value, cookie = "", origin = opts.origin) =>
    fetch(base + route, {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        "X-DLAR-Tournament": app.store.workspace.activeTournamentId,
        Cookie: cookie,
      },
      body: JSON.stringify(value),
    });
  assert.equal((await fetch(base + "/api/workspace")).status, 401);
  assert.equal((await post("/api/collector/start", { id: "123" })).status, 401);
  assert.equal(
    (
      await post(
        "/api/login",
        { password: opts.password },
        "",
        "http://evil.example",
      )
    ).status,
    403,
  );
  const login = await post("/api/login", { password: opts.password });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  assert.match(login.headers.get("set-cookie"), /HttpOnly; SameSite=Strict/);
  const read = async () => {
    const r = await fetch(base + "/api/workspace", {
      headers: { Cookie: cookie },
    });
    return r.json();
  };
  const before = await read(),
    after = structuredClone(before.config);
  after.event = "Shared cup";
  const task = {
    id: randomUUID(),
    operations: diffFields(before.config, after, ["config"]),
  };
  assert.equal((await post("/api/workspace", task, cookie)).status, 200);
  assert.equal((await read()).config.event, "Shared cup");
  const revision = (await read()).revision;
  await post("/api/workspace", task, cookie);
  assert.equal((await read()).revision, revision);
  const draft = await post("/api/draft/connect", { mode: "demo" }, cookie);
  assert.equal(draft.status, 200);
  const publicDraft = await (
    await fetch(base + "/api/broadcast?channel=draft")
  ).json();
  assert.equal(publicDraft.config.event, "Shared cup");
  assert.equal(publicDraft.draft.mode, "demo");
  assert.equal("password" in publicDraft.draft, false);
  const published = emptySession("123");
  applyFrame(published, {
    players: Array.from({ length: 12 }, (_, i) => ({
      id: String(i + 1),
      slot: i,
      team: i < 6 ? 0 : 1,
      heroId: 1,
      damage: 100,
      buffs: 2,
    })),
    duration: 120,
    endObserved: true,
    winner: 0,
  });
  published.tournamentId = app.store.workspace.activeTournamentId;
  app.store.sessions.set("123", published);
  await app.store.save(published);
  const settings = structuredClone(published.settings);
  settings.hud.x += 10;
  const calibration = { operations: diffFields(published.settings, settings) };
  assert.equal(
    (await post("/api/collector/settings?match=123", calibration, cookie))
      .status,
    200,
  );
  assert.equal(app.store.sessions.get("123").settings.hud.x, settings.hud.x);
  assert.equal(
    (await post("/api/collector/settings?match=123", calibration, cookie))
      .status,
    409,
  );
  const publish = await post(
    "/api/collector/publish?match=123",
    { ...(await read()).config, winner: 0 },
    cookie,
  );
  assert.equal(publish.status, 200);
  let board = await (
    await fetch(base + "/api/broadcast?channel=scoreboard")
  ).json();
  assert.equal(board.scoreboard.match.id, "123");
  const config = (await read()).config,
    changed = structuredClone(config);
  changed.event = "Unpublished change";
  await post(
    "/api/workspace",
    { id: randomUUID(), operations: diffFields(config, changed, ["config"]) },
    cookie,
  );
  board = await (
    await fetch(base + "/api/broadcast?channel=scoreboard")
  ).json();
  assert.equal(board.scoreboard.event, "Shared cup");
  assert.equal(
    (
      await post(
        "/api/workspace",
        { id: randomUUID(), operations: task.operations },
        cookie,
      )
    ).status,
    409,
  );
  for (const [channel, url] of Object.entries(OUTPUTS)) {
    assert.equal((await fetch(base + url)).status, 200);
    assert.equal(
      (await fetch(base + "/api/broadcast?channel=" + channel)).status,
      200,
    );
    assert.equal(new URL(url, opts.origin).search, "");
  }
  const abort = new AbortController();
  const stream = await fetch(base + "/api/broadcast/events?channel=draft", {
    signal: abort.signal,
  });
  const reader = stream.body.getReader();
  const chunk = await reader.read();
  assert.match(
    new TextDecoder().decode(chunk.value),
    /Shared cup|Unpublished change/,
  );
  abort.abort();
  await post("/api/logout", {}, cookie);
  assert.equal(
    (await fetch(base + "/api/workspace", { headers: { Cookie: cookie } }))
      .status,
    401,
  );
});
test("hosted mode refuses to expose an unprotected admin console", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "dlar-auth-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await assert.rejects(
    () => createBroadcastServer({ directory: dir, hosted: true, port: 0 }),
    /ADMIN_PASSWORD/,
  );
});

test("admin sessions survive restart but are revoked when the password changes", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "dlar-rotation-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new BroadcastDatabase(dir);
  await store.load();
  let cookie;
  const response = {
    setHeader(name, value) {
      cookie = value.split(";")[0];
    },
  };
  const request = { socket: { remoteAddress: "127.0.0.1" }, headers: {} };
  const first = new AdminAuth(store.db, "first-local-test-password");
  first.login(request, response, "first-local-test-password");
  request.headers.cookie = cookie;
  assert.equal(first.authenticated(request), true);
  const restarted = new AdminAuth(store.db, "first-local-test-password");
  assert.equal(restarted.authenticated(request), true);
  const changed = new AdminAuth(store.db, "new-local-test-password");
  assert.equal(changed.authenticated(request), false);
  assert.throws(
    () => changed.login(request, response, "first-local-test-password"),
    /Incorrect/,
  );
  changed.login(request, response, "new-local-test-password");
  request.headers.cookie = cookie;
  assert.equal(changed.authenticated(request), true);
  store.close();
});

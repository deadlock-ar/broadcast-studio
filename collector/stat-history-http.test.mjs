import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createBroadcastServer } from "./cloud-server.mjs";
import { BroadcastDatabase } from "./database.mjs";
import { emptySession, applyFrame } from "./model.mjs";
import { exportBackup, prepareRestore } from "./backups.mjs";

const frame = (time) => ({
  duration: time,
  tick: time * 64,
  players: Array.from({ length: 12 }, (_, index) => ({
    id: String(index + 1),
    name: `Player ${index + 1}`,
    slot: index,
    team: index < 6 ? 0 : 1,
    heroId: index + 1,
    damage: time * 100 + index,
    objectiveDamage: time * 4,
    healing: time * 2,
    souls: 1000 + time * 10,
    kills: Math.floor(time / 5),
    deaths: Math.floor(time / 15),
    assists: Math.floor(time / 10),
    buffs: Math.floor(time / 20),
  })),
});

function hasHistory(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      (Object.hasOwn(value, "statHistory") ||
        Object.values(value).some(hasHistory)),
  );
}

async function fixture(t) {
  const directory = await mkdtemp(
    path.join(tmpdir(), "dlar-stat-history-http-"),
  );
  const staticDirectory = path.join(directory, "web");
  await mkdir(staticDirectory);
  await writeFile(
    path.join(staticDirectory, "index.html"),
    "<main>Test studio</main>",
  );
  const app = await createBroadcastServer({
    directory,
    staticDirectory,
    port: 0,
    origin: "http://stat-history.test",
    password: "stat-history-test-admin-password",
    hosted: true,
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const streams = new Set();
  let cookie = "",
    closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    for (const stream of streams) stream.abort();
    app.server.closeIdleConnections();
    await app.shutdown();
  };
  t.after(async () => {
    await close();
    await rm(directory, { recursive: true, force: true });
  });
  const post = async (route, value, options = {}) => {
    const response = await fetch(base + route, {
      method: "POST",
      headers: {
        Origin: options.origin ?? app.origin,
        "Content-Type": "application/json",
        "X-DLAR-Tournament":
          options.tournament ?? app.store.workspace.activeTournamentId,
        Cookie: options.cookie ?? cookie,
      },
      body: JSON.stringify(value),
    });
    return { response, status: response.status, data: await response.json() };
  };
  const login = await post("/api/login", {
    password: "stat-history-test-admin-password",
  });
  assert.equal(login.status, 200);
  cookie = login.response.headers.get("set-cookie").split(";")[0];
  const get = async (route) => {
    const response = await fetch(base + route, { headers: { Cookie: cookie } });
    assert.equal(response.status, 200);
    return response.json();
  };
  const seed = async (id = "123", transform = (sample) => sample) => {
    const session = emptySession(id, "local");
    session.tournamentId = app.store.workspace.activeTournamentId;
    session.settings.names = { 1: "Desk display name" };
    for (let time = 0; time <= 180; time += 5) {
      const sample = transform(frame(time));
      if (sample) applyFrame(session, sample);
    }
    app.store.sessions.set(id, session);
    await app.store.save(session);
    return session;
  };
  const session = await seed();
  app.store.workspace.deadem.id = session.id;
  app.store.saveWorkspace();
  const events = async (route) => {
    const abort = new AbortController();
    streams.add(abort);
    const response = await fetch(base + route, {
      headers: { Cookie: cookie },
      signal: abort.signal,
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /text\/event-stream/);
    const reader = response.body.getReader(),
      decoder = new TextDecoder();
    let pending = "";
    return {
      close: () => abort.abort(),
      next: async () => {
        const timeout = setTimeout(() => abort.abort(), 5000);
        try {
          while (true) {
            const boundary = pending.indexOf("\n\n");
            if (boundary >= 0) {
              const event = pending.slice(0, boundary);
              pending = pending.slice(boundary + 2);
              const line = event
                .split("\n")
                .find((entry) => entry.startsWith("data: "));
              if (line) return JSON.parse(line.slice(6));
            } else {
              const chunk = await reader.read();
              assert.equal(
                chunk.done,
                false,
                "The event stream ended before its update",
              );
              pending += decoder.decode(chunk.value, { stream: true });
            }
          }
        } finally {
          clearTimeout(timeout);
        }
      },
    };
  };
  return { app, directory, session, post, get, seed, events, close };
}

const mark = "/api/collector/stat-window?match=123";
const range = { first: 0, last: 180, interval: 5 };

test("stat-window HTTP selects observed source-clock marks and sends compact state/events", async (t) => {
  const { app, session, post, get, events } = await fixture(t);
  const initial = await get("/api/collector/state?match=123");
  assert.equal(hasHistory(initial), false);
  assert.deepEqual(initial.statHistoryRange, range);
  const stream = await events("/api/collector/events?match=123");
  const firstEvent = await stream.next();
  assert.equal(hasHistory(firstEvent), false);
  assert.deepEqual(firstEvent.statHistoryRange, range);

  const original = structuredClone(session);
  delete original.settings.metricsBaseline;
  const workspace = structuredClone(app.store.workspace);
  for (const [selection, expected] of [
    [{ lookbackSeconds: 60 }, 120],
    [{ startTime: 87 }, 85],
    [{ from: "now" }, 180],
  ]) {
    const result = await post(mark, selection);
    assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.equal(result.data.settings.metricsBaseline.time, expected);
    assert.equal(result.data.settings.metricsBaseline.players.length, 12);
    assert.equal(
      result.data.settings.metricsBaseline.players[0].damage,
      expected * 100,
    );
    assert.equal(session.settings.metricsBaseline.time, expected);
    assert.equal(hasHistory(result.data), false);
    assert.deepEqual(result.data.statHistoryRange, range);
    const update = await stream.next();
    assert.equal(update.settings.metricsBaseline.time, expected);
    assert.equal(hasHistory(update), false);
    assert.deepEqual(update.statHistoryRange, range);
    const unchanged = structuredClone(session);
    delete unchanged.settings.metricsBaseline;
    assert.deepEqual(
      unchanged,
      original,
      "Selecting a window must not change observations or unrelated settings",
    );
    assert.deepEqual(app.store.workspace, workspace);
  }
  stream.close();
  assert.equal(
    (await get("/api/collector/state?match=123")).settings.metricsBaseline.time,
    180,
  );
  for (const channel of ["deadem", "momentum", "ultimates"]) {
    const output = await get(`/api/broadcast?channel=${channel}`);
    assert.equal(output.session.id, session.id);
    assert.equal(
      hasHistory(output),
      false,
      `${channel} exposed full stat history`,
    );
  }
  const publicStream = await events("/api/broadcast/events?channel=deadem");
  assert.equal(hasHistory(await publicStream.next()), false);
  publicStream.close();
});

test("stat-window HTTP rejects unauthorized, stale-tournament, invalid and unavailable marks atomically", async (t) => {
  const { app, session, post, seed } = await fixture(t);
  assert.equal((await post(mark, { from: "now" }, { cookie: "" })).status, 401);
  assert.equal(
    (await post(mark, { from: "now" }, { origin: "http://untrusted.test" }))
      .status,
    403,
  );
  assert.equal(
    (await post(mark, { from: "now" }, { tournament: randomUUID() })).status,
    409,
  );
  assert.equal((await post(mark, { startTime: 85 })).status, 200);
  const baseline = structuredClone(session.settings.metricsBaseline);
  for (const selection of [
    {},
    { from: "yesterday" },
    { from: "now", startTime: 85 },
    { lookbackSeconds: 60, startTime: 85 },
    { lookbackSeconds: -1 },
    { lookbackSeconds: 181 },
    { startTime: -1 },
    { startTime: 181 },
    { startTime: "85" },
    { metricsBaseline: { time: 0, players: [] } },
  ]) {
    const result = await post(mark, selection);
    assert.equal(result.status, 400, JSON.stringify(selection));
    assert.deepEqual(session.settings.metricsBaseline, baseline);
  }

  const updatedAt = session.updatedAt;
  session.updatedAt = Date.now() - 60000;
  assert.equal((await post(mark, { from: "now" })).status, 400);
  session.updatedAt = updatedAt;
  session.status = "interrupted";
  assert.equal((await post(mark, { lookbackSeconds: 60 })).status, 400);
  session.status = "live";
  assert.deepEqual(session.settings.metricsBaseline, baseline);

  const history = session.statHistory;
  delete session.statHistory;
  assert.equal((await post(mark, { lookbackSeconds: 60 })).status, 400);
  session.statHistory = history;
  assert.deepEqual(session.settings.metricsBaseline, baseline);

  const gap = await seed("124", (sample) =>
    sample.duration >= 80 && sample.duration <= 85 ? null : sample,
  );
  assert.equal(
    (await post("/api/collector/stat-window?match=124", { startTime: 87 }))
      .status,
    400,
  );
  assert.equal(gap.settings.metricsBaseline ?? null, null);
  const changedTeams = await seed("125", (sample) => {
    if (sample.duration >= 90)
      [sample.players[0].team, sample.players[6].team] = [1, 0];
    return sample;
  });
  assert.equal(
    (await post("/api/collector/stat-window?match=125", { startTime: 85 }))
      .status,
    400,
  );
  assert.equal(changedTeams.settings.metricsBaseline ?? null, null);
  const partial = await seed("126");
  const incomplete = frame(185);
  incomplete.players.pop();
  applyFrame(partial, incomplete);
  assert.equal(
    partial.match.players.length,
    12,
    "Merged old identities remain present",
  );
  assert.equal(
    (await post("/api/collector/stat-window?match=126", { from: "now" }))
      .status,
    400,
  );
  assert.equal(partial.settings.metricsBaseline ?? null, null);

  const foreign = await seed("127");
  foreign.tournamentId = randomUUID();
  assert.equal(
    (await post("/api/collector/stat-window?match=127", { from: "now" }))
      .status,
    400,
  );
  assert.equal(foreign.settings.metricsBaseline ?? null, null);
  assert.deepEqual(session.settings.metricsBaseline, baseline);
  assert.equal(app.store.sessions.get("123"), session);
});

test("server-selected marks and full private stat history survive backups and SQLite restart", async (t) => {
  const { app, directory, session, post, close } = await fixture(t);
  const response = await post(mark, { lookbackSeconds: 60 });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  const history = structuredClone(session.statHistory);
  const baseline = structuredClone(session.settings.metricsBaseline);
  assert.equal(history.points.length, 37);
  assert.equal(history.points[0][0], 0);
  assert.equal(history.points.at(-1)[0], 180);
  const backup = exportBackup(app.store);
  assert.deepEqual(
    backup.matches.find((item) => item.id === "123").statHistory,
    history,
  );
  const restored = prepareRestore(backup, app.store);
  const recoveredBackup = restored.sessions.find((item) => item.id === "123");
  assert.deepEqual(recoveredBackup.statHistory, history);
  assert.deepEqual(recoveredBackup.settings.metricsBaseline, baseline);

  await close();
  const database = new BroadcastDatabase(directory);
  await database.load();
  try {
    const recovered = database.sessions.get("123");
    assert.deepEqual(recovered.statHistory, history);
    assert.deepEqual(recovered.settings.metricsBaseline, baseline);
    assert.equal(recovered.status, "interrupted");
  } finally {
    database.close();
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { repairRecording } from "./recording-repair.mjs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createBroadcastServer } from "./cloud-server.mjs";

function fixture() {
  const frame = {
    matchId: "134405814",
    tick: 100,
    duration: 60,
    winner: 0,
    endObserved: true,
    players: Array.from({ length: 12 }, (_, i) => ({
      id: String(i + 1),
      team: i < 6 ? 0 : 1,
      heroId: i + 1,
      kills: 1,
      deaths: 2,
      assists: 3,
      souls: 100,
      damage: 100,
      healing: 0,
      objectiveDamage: 0,
      items: [90],
      abilities: Array.from({ length: 4 }, (_, j) => ({
        slot: j + 1,
        id: j + 10,
        level: 3,
        unlocked: true,
      })),
    })),
  };
  const session = {
    result: { winner: 0, match: structuredClone(frame) },
    match: structuredClone(frame),
    recording: { fromStart: true },
    published: structuredClone(frame),
    seriesAward: { winner: 0 },
    bracketAward: { id: "keep" },
    settings: { names: { 1: "Name" } },
    items: {
      fromStart: true,
      purchases: [
        { id: "buy1", playerId: "1", itemId: 90, status: "confirmed" },
      ],
    },
    itemReviews: { buy1: { status: "refunded", evidence: "Operator review" } },
  };
  for (const p of session.result.match.players) p.items = [];
  const value = {
    version: 1,
    kind: "deadlock-recording-repair",
    frame,
    items: {
      fromStart: true,
      purchases: [
        {
          id: "buy1",
          tick: 20,
          playerId: "1",
          itemId: 90,
          status: "confirmed",
        },
      ],
    },
  };
  return { session, value };
}
test("recording repair fills details while preserving the published snapshot and all awards", () => {
  const { session, value } = fixture();
  const before = structuredClone(session);
  repairRecording(session, value, [{ id: 90 }], 123);
  assert.deepEqual(session.result.match.players[0].items, [90]);
  assert.equal(session.items.purchases.length, 1);
  assert.equal(session.items.purchases[0].status, "refunded");
  for (const key of [
    "published",
    "seriesAward",
    "bracketAward",
    "settings",
    "itemReviews",
  ])
    assert.deepEqual(session[key], before[key]);
  const withoutDetails = (player) => {
    const copy = { ...player };
    delete copy.items;
    delete copy.abilities;
    return copy;
  };
  assert.deepEqual(
    session.result.match.players.map(withoutDetails),
    before.result.match.players.map(withoutDetails),
  );
  assert.deepEqual(
    session.match.players.map(withoutDetails),
    before.match.players.map(withoutDetails),
  );
  assert.equal(session.result.recordingRepair.repairedAt, 123);
});
test("recording repairs reject different outcomes, rosters, counters and unknown items without mutation", () => {
  for (const mutate of [
    (v) => (v.frame.winner = 1),
    (v) => (v.frame.matchId = "other"),
    (v) => (v.frame.players[0].id = "99"),
    (v) => v.frame.players[0].souls++,
    (v) => (v.frame.players[0].items = [100]),
    (v) => (v.items.purchases[0].playerId = "100"),
    (v) => (v.frame.tick = undefined),
    (v) => (v.frame.tick = -1),
    (v) => (v.frame.tick = Infinity),
    (v) => (v.frame.players[0] = null),
    (v) => (v.frame.players[0].abilities[0] = null),
    (v) => (v.items.purchases[0] = null),
    (v) => (v.items.purchases[0].id = ""),
    (v) => (v.items.purchases[0].tick = v.frame.tick + 1),
    (v) => (v.items.fromStart = false),
  ]) {
    const { session, value } = fixture();
    const before = structuredClone(session);
    mutate(value);
    assert.throws(
      () => repairRecording(session, value, [{ id: 90 }]),
      /does not match/,
    );
    assert.deepEqual(session, before);
  }
});

test("repair upload requires the signed-in admin and current tournament and persists without republishing", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "dlar-repair-"));
  const app = await createBroadcastServer({
    directory,
    port: 0,
    hosted: true,
    origin: "http://repair.test",
    password: "recording-repair-test-password",
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await app.shutdown();
    await rm(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const post = async (route, body, headers = {}) => {
    const response = await fetch(base + route, {
      method: "POST",
      headers: {
        Origin: app.origin,
        "Content-Type": "application/json",
        "X-DLAR-Tournament": app.store.workspace.activeTournamentId,
        ...headers,
      },
      body: JSON.stringify(body),
    });
    return {
      status: response.status,
      headers: response.headers,
      data: await response.json(),
    };
  };
  const login = await post("/api/login", {
    password: "recording-repair-test-password",
  });
  const cookie = { Cookie: login.headers.get("set-cookie").split(";")[0] };
  const { session, value } = fixture();
  session.id = "123";
  session.version = 1;
  session.tournamentId = app.store.workspace.activeTournamentId;
  // Use an actual catalog ID through the HTTP boundary.
  const catalog = JSON.parse(
    await readFile(new URL("./data/items.json", import.meta.url), "utf8"),
  );
  const itemId = catalog[0].id;
  for (const p of value.frame.players) p.items = [itemId];
  value.items.purchases[0].itemId = itemId;
  session.items.purchases[0].itemId = itemId;
  app.store.sessions.set(session.id, session);
  await app.store.save(session);
  const route = "/api/collector/repair?match=123";
  assert.equal((await post(route, value)).status, 401);
  assert.equal(
    (await post(route, value, { ...cookie, "X-DLAR-Tournament": "stale" }))
      .status,
    409,
  );
  const before = structuredClone(session);
  const workspaceBefore = structuredClone(app.store.workspace);
  const wrongFile = structuredClone(value);
  wrongFile.frame.matchId = "different";
  assert.equal((await post(route, wrongFile, cookie)).status, 400);
  assert.deepEqual(app.store.sessions.get("123"), before);
  assert.deepEqual(app.store.workspace, workspaceBefore);
  const published = structuredClone(session.published);
  assert.equal((await post(route, value, cookie)).status, 200);
  assert.deepEqual(app.store.sessions.get("123").published, published);
  assert.deepEqual(app.store.workspace, workspaceBefore);
  assert.deepEqual(session.seriesAward, before.seriesAward);
  assert.deepEqual(session.bracketAward, before.bracketAward);
  assert.equal(
    app.store.sessions.get("123").result.match.players[0].items[0],
    itemId,
  );
  const saved = JSON.parse(
    app.store.db.prepare("SELECT value FROM matches WHERE id=?").get("123")
      .value,
  );
  assert.deepEqual(saved, app.store.sessions.get("123"));
});

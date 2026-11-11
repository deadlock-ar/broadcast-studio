import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { BroadcastDatabase } from "./database.mjs";
import { Archive } from "./archive.mjs";
import { Publisher } from "./publisher.mjs";
import { sessionId, matchId, publishResult, cleanSettings } from "./model.mjs";
async function setup(t) {
  const dir = await mkdtemp(path.join(tmpdir(), "dlar-publisher-"));
  const store = new BroadcastDatabase(dir);
  await store.load();
  const pub = new Publisher(store, () => {}, { worker: null });
  t.after(async () => {
    pub.close();
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  return { store, pub };
}
const pair = (pub) => {
  const code = pub.issue({ label: "Test observer" });
  const value = pub.pair(code, "test");
  return {
    ...value,
    authenticated: () =>
      pub.authenticate({ headers: { authorization: `Bearer ${value.token}` } }),
  };
};
test("local game identities are distinct from numeric Valve match IDs", () => {
  const id = `local-${randomUUID()}`;
  assert.equal(sessionId(id), id);
  assert.throws(() => matchId(id));
  assert.throws(() => sessionId("local-../settings"));
});

test("new games inherit only ultimate preferences within the same tournament; resumes and other tournaments stay isolated", async (t) => {
  const { pub, store } = await setup(t),
    paired = pair(pub),
    identity = paired.authenticated();
  store.workspace.activeTournamentId = "tournament-a";
  const first = pub.begin(identity, { id: `local-${randomUUID()}` });
  const original = store.sessions.get(first.id);
  original.settings = cleanSettings({
    ultimateBadges: {
      enabled: false,
      iconSize: 40,
      maxPerPlayer: 2,
      byAbility: { 99: { hit: false } },
    },
    names: { 1: "Old name" },
    hudOrder: ["1"],
    delayMs: 4000,
    hud: { x: 100 },
    metricsBaseline: {
      time: 10,
      players: Array.from({ length: 12 }, (_, index) => ({
        id: String(index + 1),
        team: index < 6 ? 0 : 1,
        souls: index * 100,
      })),
    },
  });
  const before = structuredClone(original.settings);
  assert.equal(before.metricsBaseline.time, 10);
  const next = pub.begin(identity, { id: `local-${randomUUID()}` });
  const inherited = store.sessions.get(next.id);
  assert.deepEqual(inherited.settings.ultimateBadges, before.ultimateBadges);
  assert.deepEqual(original.settings, before);
  assert.deepEqual(inherited.settings.names, {});
  assert.deepEqual(inherited.settings.hudOrder, []);
  assert.equal(inherited.settings.delayMs, 0);
  assert.equal(inherited.settings.metricsBaseline, null);
  assert.equal(inherited.settings.hud.x, 460);
  inherited.settings.ultimateBadges.byAbility[99].hit = true;
  assert.equal(original.settings.ultimateBadges.byAbility[99].hit, false);
  pub.begin(identity, { id: next.id });
  assert.equal(inherited.settings.ultimateBadges.byAbility[99].hit, true);
  store.workspace.activeTournamentId = "tournament-b";
  store.workspace.deadem.id = original.id;
  const other = pub.begin(identity, { id: `local-${randomUUID()}` });
  assert.deepEqual(store.sessions.get(other.id).settings.ultimateBadges, {
    enabled: true,
    iconSize: 32,
    maxPerPlayer: 4,
    byAbility: {},
  });
  assert.deepEqual(original.settings, before);
});

test("batched source samples keep source spacing, anchor at the known edge, and finalize in order", async (t) => {
  const { pub, store } = await setup(t),
    paired = pair(pub),
    identity = paired.authenticated();
  const begun = pub.begin(identity, { id: `local-${randomUUID()}` });
  const notifications = [];
  pub.changed = (section, samples) =>
    notifications.push({
      section,
      samples: structuredClone(samples),
      timing: structuredClone(store.sessions.get(begun.id).sourceTiming),
    });
  let wall = 100000;
  t.mock.method(Date, "now", () => wall);
  const players = Array.from({ length: 12 }, (_, index) => ({
    id: String(index + 1),
    heroId: 1,
    team: index < 6 ? 0 : 1,
  }));
  const sample = (tick, sourceClockMs, endObserved = false) => ({
    sourceClockMs,
    decodedAt: wall,
    readAt: wall - 10,
    frame: {
      tick,
      serverTick: tick,
      duration: tick,
      players,
      endObserved,
      winner: 0,
    },
  });
  pub.ingest(identity, {
    ...begun,
    sequence: 1,
    liveEdgeClockMs: 10000,
    samples: [sample(1, 1000), sample(2, 1250)],
  });
  const first = notifications.find((row) => row.samples).samples;
  assert.deepEqual(
    first.map((s) => s.sourceTiming.sourceAt),
    [91000, 91250],
  );
  assert.equal(first.at(-1).sourceTiming.readAt, 99990);
  wall += 1000;
  notifications.length = 0;
  pub.ingest(identity, {
    ...begun,
    sequence: 2,
    liveEdgeClockMs: 11000,
    samples: [sample(3, 10000), sample(4, 10250), sample(5, 10500, true)],
  });
  assert.equal(notifications[0].section, "collector");
  assert.deepEqual(
    notifications[0].samples.map((s) => s.sourceTiming.sourceAt),
    [100000, 100250, 100500],
  );
  assert.equal(notifications.at(-1).timing.sourceAt, 100500);
  assert.equal(store.sessions.get(begun.id).result.match.tick, 5);
  assert.equal(store.workspace.config.teams[0].score, 1);
  const sequence = store.sessions.get(begun.id).sequence;
  pub.ingest(identity, { ...begun, sequence: 2, samples: [sample(6, 11000)] });
  assert.equal(store.sessions.get(begun.id).sequence, sequence);
});

test("malformed batches do not partially apply and fast catchup cannot create distant future targets", async (t) => {
  const { pub, store } = await setup(t),
    paired = pair(pub),
    identity = paired.authenticated();
  const begun = pub.begin(identity, { id: `local-${randomUUID()}` });
  t.mock.method(Date, "now", () => 100000);
  const sample = (tick, clock) => ({
    sourceClockMs: clock,
    frame: { tick, duration: tick, players: [{ id: "1", heroId: 1, team: 0 }] },
  });
  assert.throws(
    () =>
      pub.ingest(identity, {
        ...begun,
        sequence: 1,
        samples: [sample(1, 0), { frame: { players: [{}] } }],
      }),
    /Invalid source sample/,
  );
  assert.equal(store.sessions.get(begun.id).match, null);
  pub.ingest(identity, { ...begun, sequence: 1, samples: [sample(1, 0)] });
  const oldTimeline = store.sessions.get(begun.id).sourceTiming.timelineId;
  pub.ingest(identity, {
    ...begun,
    sequence: 2,
    liveEdgeClockMs: 1800000,
    samples: [sample(2, 1799750), sample(3, 1800000)],
  });
  const timing = store.sessions.get(begun.id).sourceTiming;
  assert.equal(timing.sourceAt, timing.receivedAt);
  assert.notEqual(timing.timelineId, oldTimeline);
});
test("pairing is one-time, credentials are scoped and revocable", async (t) => {
  const { pub } = await setup(t);
  const code = pub.issue();
  const p = pub.pair(code, "a");
  assert.throws(() => pub.pair(code, "a"));
  assert.throws(() => pub.authenticate({ headers: {} }));
  assert.equal(
    pub.authenticate({ headers: { authorization: `Bearer ${p.token}` } }).id,
    p.publisherId,
  );
  assert.ok(!JSON.stringify(pub.list()).includes(p.token));
  pub.revoke(p.publisherId);
  assert.throws(() =>
    pub.authenticate({ headers: { authorization: `Bearer ${p.token}` } }),
  );
});
test("only one observer can publish; reconnect fences the old process and deduplicates frames", async (t) => {
  const { pub, store } = await setup(t),
    p = pair(pub),
    q = pair(pub),
    id = `local-${randomUUID()}`;
  const first = pub.begin(p.authenticated(), { id, fromStart: true });
  assert.throws(
    () => pub.begin(q.authenticated(), { id: `local-${randomUUID()}` }),
    /Another observer/,
  );
  const frame = {
    tick: 10,
    duration: 2,
    players: [{ id: "123", heroId: 1, team: 0, slot: 1, damage: 4 }],
  };
  const send = { ...first, sequence: 1, frame };
  pub.ingest(p.authenticated(), send);
  pub.ingest(p.authenticated(), send);
  assert.equal(store.sessions.get(id).sequence, 1);
  const next = pub.begin(p.authenticated(), { id });
  assert.throws(
    () => pub.ingest(p.authenticated(), { ...send, sequence: 2 }),
    /replaced/,
  );
  pub.ingest(p.authenticated(), {
    ...next,
    sequence: 1,
    frame: { ...frame, tick: 5, duration: 1 },
  });
  assert.equal(store.sessions.get(id).match.tick, 10);
  pub.ingest(p.authenticated(), { ...next, sequence: 2, stopped: true });
  assert.equal(store.sessions.get(id).result, null);
  assert.equal(store.sessions.get(id).status, "interrupted");
});
test("draft archive updates one live code and preserves the tournament after branding changes", async (t) => {
  const { store } = await setup(t);
  const archive = new Archive(store);
  store.workspace.draft.mode = "live";
  store.workspace.draft.code = "ABCDEFGH";
  store.workspace.draft.snapshot.steps[0].heroId = 1;
  store.workspace.config.event = "Cup A";
  archive.capture();
  store.workspace.config.event = "Cup B";
  store.workspace.draft.snapshot.steps[1].heroId = 2;
  archive.capture();
  assert.equal(archive.list().length, 1);
  assert.equal(archive.list()[0].tournament, "Cup A");
  assert.equal(archive.list()[0].selections.filter((s) => s.heroId).length, 2);
});

test("ended observer games freeze enriched fields and award one series point across retries and database restart", async (t) => {
  const { store, pub } = await setup(t),
    p = pair(pub),
    id = `local-${randomUUID()}`;
  const connection = pub.begin(p.authenticated(), {
    id,
    fromStart: true,
    clientVersion: "0.2.0",
  });
  const players = Array.from({ length: 12 }, (_, i) => ({
    id: String(i + 100),
    name: `Player ${i}`,
    heroId: i + 1,
    team: i < 6 ? 0 : 1,
    slot: i + 1,
    items: [123],
    objectiveDamage: 44,
    abilities: [{ slot: 1, id: 321, level: null, unlocked: null }],
  }));
  const frame = {
    tick: 500,
    duration: 120,
    players,
    matchId: "123696895",
    endObserved: true,
    winner: 0,
  };
  const send = { ...connection, sequence: 1, frame };
  pub.ingest(p.authenticated(), send);
  pub.ingest(p.authenticated(), send);
  assert.equal(store.workspace.config.teams[0].score, 1);
  const session = store.sessions.get(id);
  assert.equal(session.result.match.matchId, "123696895");
  assert.equal(session.result.match.players[0].objectiveDamage, 44);
  assert.equal(session.result.match.players[0].abilities[0].unlocked, null);
  publishResult(session, { winner: 0, mvpId: "100" });
  await store.save(session);
  const reopened = new BroadcastDatabase(store.directory);
  await reopened.load();
  try {
    assert.equal(reopened.workspace.config.teams[0].score, 1);
    assert.equal(reopened.sessions.get(id).seriesAward.winner, 0);
    assert.equal(reopened.sessions.get(id).published.mvpId, "100");
    assert.deepEqual(
      reopened.sessions.get(id).published.match.players[0].items,
      [123],
    );
  } finally {
    reopened.close();
  }
  const resumed = pub.begin(p.authenticated(), { id });
  pub.ingest(p.authenticated(), {
    ...resumed,
    sequence: 1,
    frame: { ...frame, tick: 501 },
  });
  assert.equal(store.workspace.config.teams[0].score, 1);
});

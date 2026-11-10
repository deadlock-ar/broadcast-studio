import test from "node:test";
import assert from "node:assert/strict";
import {
  applyRecordedSources,
  publishRecordedSources,
} from "./recorded-sources.mjs";
import { BroadcastDatabase } from "./database.mjs";
import { Publisher } from "./publisher.mjs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

const frame = (ended = true) => ({
  matchId: "134405814",
  tick: 100,
  duration: 1831,
  winner: 0,
  endObserved: ended,
  players: Array.from({ length: 12 }, (_, i) => ({
    id: String(i + 1),
    slot: i + 1,
    team: i < 6 ? 0 : 1,
    heroId: i + 1,
    souls: 10000 + i,
    kills: i,
    items: [90],
  })),
});
const sources = () => ({
  version: 1,
  source: "recording-post-match",
  matchId: "134405814",
  duration: 1831,
  players: frame().players.map(({ id, slot, team, heroId }) => ({
    id,
    slot,
    team,
    heroId,
    sampleTime: 1831,
    soulsBySource: [
      {
        source: 2,
        label: "Troopers",
        gold: 100,
        knownGold: 100,
        complete: true,
      },
      {
        source: 3,
        label: "Neutrals",
        gold: null,
        knownGold: 50,
        complete: false,
      },
    ],
  })),
});

test("late recorded source details only add income, retaining frozen stats, publication and awards", () => {
  const snapshot = frame();
  const session = {
    match: structuredClone(snapshot),
    result: { match: structuredClone(snapshot), winner: 0 },
    published: { match: structuredClone(snapshot) },
    seriesAward: { winner: 0 },
    bracketAward: { id: "keep" },
  };
  const before = structuredClone(session);
  applyRecordedSources(session, sources(), 123);
  assert.equal(session.result.match.players[0].soulsBySource[1].gold, null);
  assert.equal(session.result.match.players[0].soulsBySource[1].knownGold, 50);
  assert.equal(session.result.sourceBreakdown.receivedAt, 123);
  for (const key of ["published", "seriesAward", "bracketAward"])
    assert.deepEqual(session[key], before[key]);
  for (let i = 0; i < 12; i++) {
    const { soulsBySource, ...row } = session.result.match.players[i];
    assert.equal(soulsBySource.length, 2);
    assert.deepEqual(row, before.result.match.players[i]);
  }
});
test("wrong game, roster, source timestamp and malformed income are rejected without mutation", () => {
  for (const mutate of [
    (s) => (s.matchId = "1"),
    (s) => (s.duration = 20),
    (s) => (s.players[0].id = "99"),
    (s) => (s.players[0].slot = 99),
    (s) => (s.players[0].heroId = 99),
    (s) => (s.players[0].team = 1),
    (s) => (s.players[0].sampleTime = 0),
    (s) => (s.players[0].soulsBySource[0].gold = -1),
    (s) => (s.players[0].soulsBySource[1].gold = 50),
    (s) => (s.players[1].id = s.players[0].id),
  ]) {
    const session = {
      match: frame(),
      result: { match: frame(), winner: 0 },
      published: { match: frame() },
    };
    const before = structuredClone(session);
    const value = sources();
    mutate(value);
    assert.throws(() => applyRecordedSources(session, value), /does not match/);
    assert.deepEqual(session, before);
  }
});

test("publishing recovered sources keeps the previously published presentation and all other player fields", () => {
  const snapshot = frame();
  const session = {
    match: structuredClone(snapshot),
    result: { match: structuredClone(snapshot), winner: 0 },
    published: {
      match: structuredClone(snapshot),
      teams: [
        { name: "Original left", score: 1 },
        { name: "Original right", score: 0 },
      ],
      game: 2,
      round: "Quarterfinals",
      names: { 1: "Saved name" },
      mvpId: "1",
      publishedAt: 10,
    },
    seriesAward: { winner: 0 },
  };
  const original = structuredClone(session.published);
  applyRecordedSources(session, sources(), 123);
  publishRecordedSources(session, 456);
  const { sourceBreakdown, sourcesPublishedAt, ...published } =
    session.published;
  assert.equal(sourceBreakdown.receivedAt, 123);
  assert.equal(sourcesPublishedAt, 456);
  published.match = {
    ...published.match,
    players: published.match.players.map((p) => {
      const next = { ...p };
      delete next.soulsBySource;
      return next;
    }),
  };
  assert.deepEqual(published, original);
  assert.deepEqual(session.seriesAward, { winner: 0 });
});
test("publisher retains source details received before game over and accepts verified late details", async (t) => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "dlar-recorded-sources-"),
  );
  const store = new BroadcastDatabase(directory);
  await store.load();
  const pub = new Publisher(store, () => {}, { worker: null });
  t.after(async () => {
    pub.close();
    store.close();
    await rm(directory, { recursive: true, force: true });
  });
  const code = pub.issue({});
  const paired = pub.pair(code, "test");
  const identity = pub.authenticate({
    headers: { authorization: `Bearer ${paired.token}` },
  });
  for (const early of [true, false]) {
    const begun = pub.begin(identity, { id: `local-${randomUUID()}` });
    pub.ingest(identity, {
      ...begun,
      sequence: 1,
      frame: frame(false),
      ...(early ? { sourceBreakdown: sources() } : {}),
    });
    pub.ingest(identity, {
      ...begun,
      sequence: 2,
      frame: { ...frame(true), tick: 110 },
    });
    const session = store.sessions.get(begun.id);
    const before = structuredClone(
      session.result.match.players.map((p) => {
        const row = { ...p };
        delete row.soulsBySource;
        return row;
      }),
    );
    if (!early)
      pub.ingest(identity, {
        ...begun,
        sequence: 3,
        sourceBreakdown: sources(),
      });
    assert.equal(
      session.result.match.players.filter((p) => p.soulsBySource?.length === 2)
        .length,
      12,
    );
    assert.deepEqual(
      session.result.match.players.map(({ soulsBySource, ...p }) => {
        assert.equal(soulsBySource.length, 2);
        return p;
      }),
      before,
    );
    assert.equal(session.published, null);
  }
});

test("wrong source duration in an end packet or a cached add-on cannot freeze results or award points", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "dlar-source-atomic-"));
  const store = new BroadcastDatabase(directory);
  await store.load();
  const pub = new Publisher(store, () => {}, { worker: null });
  t.after(async () => {
    pub.close();
    store.close();
    await rm(directory, { recursive: true, force: true });
  });
  const paired = pub.pair(pub.issue({}), "test");
  const identity = pub.authenticate({
    headers: { authorization: `Bearer ${paired.token}` },
  });
  for (const cached of [false, true]) {
    const begun = pub.begin(identity, { id: `local-${randomUUID()}` });
    const matchId = cached ? "134405815" : "134405814";
    const good = { ...sources(), matchId };
    const bad = { ...sources(), matchId };
    bad.duration = 1000;
    for (const p of bad.players) p.sampleTime = 1000;
    pub.ingest(identity, {
      ...begun,
      sequence: 1,
      frame: { ...frame(false), matchId },
      ...(cached ? { sourceBreakdown: bad } : {}),
    });
    const session = store.sessions.get(begun.id);
    const before = structuredClone(session);
    const scores = store.workspace.config.teams.map((t) => t.score);
    assert.throws(
      () =>
        pub.ingest(identity, {
          ...begun,
          sequence: 2,
          frame: { ...frame(true), matchId, tick: 110 },
          ...(!cached ? { sourceBreakdown: bad } : {}),
        }),
      /does not match/,
    );
    assert.deepEqual(session, before);
    assert.deepEqual(
      store.workspace.config.teams.map((t) => t.score),
      scores,
    );
    assert.equal(session.result, null);
    assert.equal(session.seriesAward, undefined);
    pub.ingest(identity, {
      ...begun,
      sequence: 2,
      frame: { ...frame(true), matchId, tick: 110 },
      sourceBreakdown: good,
    });
    assert.ok(session.result);
    assert.ok(session.seriesAward);
    assert.equal(store.workspace.config.teams[0].score, scores[0] + 1);
  }
});

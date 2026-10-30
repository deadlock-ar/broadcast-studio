import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { BroadcastDatabase } from "./database.mjs";
import { Archive } from "./archive.mjs";
import { Publisher } from "./publisher.mjs";
import { sessionId, matchId, publishResult } from "./model.mjs";
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

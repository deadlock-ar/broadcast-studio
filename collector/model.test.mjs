import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  emptySession,
  applyFrame,
  applyInterruption,
  publishResult,
  cleanSettings,
  broadcastUrl,
} from "./model.mjs";
import { SessionStore } from "./store.mjs";
const players = () =>
  Array.from({ length: 12 }, (_, i) => ({
    id: String(i + 1),
    team: i < 6 ? 0 : 1,
    slot: i,
    heroId: i + 1,
    damage: i * 100,
    buffs: i,
    kills: 0,
    deaths: 0,
    assists: 0,
  }));
const frame = (overrides) => ({
  duration: 600,
  players: players(),
  endObserved: false,
  winner: null,
  ...overrides,
});

test("interruption retains data without creating a final scoreboard", () => {
  const s = emptySession("120901644");
  applyFrame(s, frame(), 1000);
  s.effects = [{ key: "stun" }];
  applyInterruption(s, "relay unavailable");
  assert.equal(s.status, "interrupted");
  assert.equal(s.match.players.length, 12);
  assert.equal(s.result, null);
  assert.deepEqual(s.effects, []);
  assert.throws(() => publishResult(s, { winner: 0 }), /ended-game/);
});
test("a genuine game end freezes the captured result before controller disconnects", () => {
  const s = emptySession("120901644");
  applyFrame(s, frame({ endObserved: true, winner: 1 }), 1000);
  applyFrame(s, frame({ players: [], duration: 0 }), 2000);
  assert.equal(s.result.match.duration, 600);
  assert.equal(s.result.match.players.length, 12);
  assert.equal(s.result.winner, 1);
  assert.equal(s.status, "finished");
});
test("unknown fields on reconnect retain prior totals, while real zero is accepted", () => {
  const s = emptySession("1");
  applyFrame(s, frame());
  applyFrame(
    s,
    frame({ players: [{ ...players()[5], damage: null, buffs: 0 }] }),
  );
  const p = s.match.players.find((p) => p.id === "6");
  assert.equal(p.damage, 500);
  assert.equal(p.buffs, 0);
  assert.equal(s.match.currentComplete, false);
});
test("publishing requires a confirmed winner and isolates on-air results from later edits", () => {
  const s = emptySession("1");
  applyFrame(s, frame({ endObserved: true }));
  assert.throws(() => publishResult(s, { winner: null }), /winning team/);
  const result = publishResult(s, {
    winner: 0,
    teams: [
      { name: "الأبطال", score: 2 },
      { name: "Visitors", score: 1 },
    ],
  });
  s.result.match.players[0].damage = 999;
  s.settings.names["1"] = "Changed";
  assert.equal(result.match.players[0].damage, 0);
  assert.equal(result.names["1"], undefined);
  assert.equal(result.teams[0].name, "الأبطال");
});
test("settings and relay input are bounded; a match cannot fetch an arbitrary host", () => {
  const s = cleanSettings({
    delayMs: 999999,
    hud: { size: 10000, x: -20 },
    names: { abc: "invalid", 1: "Name" },
  });
  assert.equal(s.delayMs, 120000);
  assert.equal(s.hud.size, 90);
  assert.equal(s.hud.x, 0);
  assert.deepEqual(s.names, { 1: "Name" });
  assert.equal(
    broadcastUrl("http://dist1-ord1.steamcontent.com/tv/123_456", "123"),
    "http://dist1-ord1.steamcontent.com/tv/123_456",
  );
  for (const url of [
    "http://localhost/tv/123_456",
    "https://example.com/tv/123_456",
    "http://dist1-ord1.steamcontent.com/tv/124_456",
  ])
    assert.throws(() => broadcastUrl(url, "123"));
});
test("disk archive recovers published results and labels unfinished sessions after restart", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "dlar-store-test-"));
  try {
    const first = new SessionStore(directory);
    await first.load();
    const finished = emptySession("1");
    applyFrame(finished, frame({ endObserved: true, winner: 0 }));
    publishResult(finished, { winner: 0 });
    const live = emptySession("2");
    applyFrame(live, frame());
    await first.save(finished);
    await first.save(live);
    const second = new SessionStore(directory);
    await second.load();
    assert.equal(second.sessions.get("1").published.match.players.length, 12);
    assert.equal(second.sessions.get("2").status, "interrupted");
    assert.equal(second.sessions.get("2").result, null);
    assert.equal(
      JSON.parse(await readFile(path.join(directory, "1.json"))).id,
      "1",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

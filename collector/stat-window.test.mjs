import test from "node:test";
import assert from "node:assert/strict";
import { applyFrame, emptySession } from "./model.mjs";
import { captureBaseline } from "./telemetry.mjs";
import { statWindowMatch } from "./stat-window.mjs";
import { playersAt } from "../src/stats.js";

const frame = (time) => ({
  duration: time,
  players: Array.from({ length: 12 }, (_, index) => ({
    id: String(index + 1),
    team: index < 6 ? 0 : 1,
    slot: index + 1,
    heroId: index + 1,
    name: `Player ${index + 1}`,
    damage: time * 100,
    objectiveDamage: time * 4,
    healing: time * 2,
    souls: 1000 + time * 10,
    kills: Math.floor(time / 5),
    deaths: Math.floor(time / 15),
    assists: Math.floor(time / 10),
    buffs: Math.floor(time / 20),
  })),
});
const marked = (mode = "local") => {
  const session = emptySession("123", mode);
  applyFrame(session, frame(60));
  session.settings.metricsBaseline = captureBaseline(session.match);
  return session;
};

test("whole-game panels keep the original observed match without changing the archive", () => {
  const session = emptySession("123");
  applyFrame(session, frame(60));
  assert.equal(statWindowMatch(session), session.match);
  applyFrame(session, { ...frame(70), endObserved: true, winner: 0 });
  assert.equal(statWindowMatch(session), session.result.match);
  assert.equal(statWindowMatch(null), null);
});

test("stat windows subtract all eight observed values and retain names, heroes and raw graph history", () => {
  const session = marked();
  applyFrame(session, frame(80));
  const original = structuredClone(session.match);
  const window = statWindowMatch(session);
  assert.deepEqual(
    Object.fromEntries(
      [
        "damage",
        "objectiveDamage",
        "healing",
        "souls",
        "kills",
        "deaths",
        "assists",
        "buffs",
      ].map((key) => [key, window.players[0][key]]),
    ),
    {
      damage: 2000,
      objectiveDamage: 80,
      healing: 40,
      souls: 200,
      kills: 4,
      deaths: 1,
      assists: 2,
      buffs: 1,
    },
  );
  assert.equal(window.players[0].name, "Player 1");
  assert.equal(window.players[0].heroId, 1);
  assert.equal(window.players[0].id, "1");
  assert.equal(window.players[0].team, 0);
  assert.equal(playersAt(window)[0].damage, 2000);
  assert.deepEqual(session.match, original);
  assert.equal(window.telemetry, session.match.telemetry);
  assert.equal(window.metricFrame, session.match.metricFrame);
});

test("observed zero changes stay zero, missing current fields do not reuse merged totals", () => {
  const session = marked();
  let window = statWindowMatch(session);
  assert.equal(window.players[0].damage, 0);
  assert.equal(window.players[0].buffs, 0);
  const next = frame(65);
  delete next.players[0].damage;
  delete next.players[0].buffs;
  applyFrame(session, next);
  assert.equal(session.match.players[0].damage, 6000);
  assert.equal(session.match.players[0].buffs, 3);
  window = statWindowMatch(session);
  assert.equal(window.players[0].damage, null);
  assert.equal(window.players[0].buffs, null);
  assert.equal(window.players[1].damage, 500);
});

test("net worth can fall but cumulative counter resets remain unknown", () => {
  const session = marked();
  const next = frame(65);
  Object.assign(next.players[0], { souls: 1500, damage: 1, buffs: 1 });
  applyFrame(session, next);
  const window = statWindowMatch(session);
  assert.equal(window.players[0].souls, -100);
  assert.equal(window.players[0].damage, null);
  assert.equal(window.players[0].buffs, null);
  assert.equal(window.players[0].healing, 10);
});

test("stale or disconnected windows stay unknown while finished windows keep their final changes", () => {
  const session = marked();
  applyFrame(session, frame(80));
  assert.equal(
    statWindowMatch(session, { stale: true }).players[0].damage,
    null,
  );
  session.status = "interrupted";
  assert.equal(statWindowMatch(session).players[0].damage, null);
  applyFrame(session, { ...frame(80), endObserved: true, winner: 0 });
  assert.equal(statWindowMatch(session).players[0].damage, 2000);
  assert.equal(
    statWindowMatch(session, { stale: true }).players[0].damage,
    null,
  );
});

test("changed teams, missing players, and backward replay observations cannot produce window values", () => {
  const session = marked("replay");
  applyFrame(session, frame(65));
  assert.equal(statWindowMatch(session).players[0].damage, 500);
  const reversed = frame(70);
  [reversed.players[0].team, reversed.players[6].team] = [1, 0];
  applyFrame(session, reversed);
  assert.equal(statWindowMatch(session).players[0].damage, null);
  const partial = frame(75);
  partial.players.pop();
  applyFrame(session, partial);
  assert.equal(statWindowMatch(session).players[0].damage, null);
  applyFrame(session, frame(55));
  assert.equal(statWindowMatch(session).players[0].damage, null);
});

test("finished sampled matches expose delta snapshot values instead of recomputing historical totals", () => {
  const session = marked();
  applyFrame(session, frame(80));
  session.match.mode = "finished";
  session.match.players[0].samples = [{ time: 80, damage: 8000 }];
  session.match.players[0].final = { kills: 16 };
  const window = statWindowMatch(session);
  assert.equal(window.mode, "snapshot");
  assert.equal(playersAt(window, 80)[0].damage, 2000);
});

test("old marks without buff observations leave buff changes unknown", () => {
  const session = marked();
  session.settings.metricsBaseline.players.forEach(
    (player) => delete player.buffs,
  );
  applyFrame(session, frame(80));
  const window = statWindowMatch(session);
  assert.equal(window.players[0].buffs, null);
  assert.equal(window.players[0].damage, 2000);
});

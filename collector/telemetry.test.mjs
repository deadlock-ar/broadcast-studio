import test from "node:test";
import assert from "node:assert/strict";
import { applyFrame, emptySession, publishResult } from "./model.mjs";
import {
  metricFrame,
  recordTelemetry,
  captureBaseline,
  changesSince,
  netWorthRates,
  soulsSegments,
  TELEMETRY_LIMIT,
  cleanMetricsBaseline,
  currentMetricRows,
} from "./telemetry.mjs";

const frame = (time, overrides = {}) => ({
  duration: time,
  players: Array.from({ length: 12 }, (_, i) => ({
    id: String(i + 1),
    team: i < 6 ? 0 : 1,
    slot: i,
    heroId: i + 1,
    souls: 1000 + time * (i < 6 ? 10 : 8),
    damage: time * 100,
    objectiveDamage: time * 4,
    healing: time,
    kills: Math.floor(time / 5),
    deaths: 0,
    assists: Math.floor(time / 10),
  })),
  ...overrides,
});

test("telemetry samples raw rosters, preserves gaps and never fills an earlier history", () => {
  const s = emptySession("1");
  applyFrame(s, frame(600));
  assert.equal(s.match.telemetry.points[0].time, 600);
  applyFrame(s, frame(601));
  assert.equal(s.match.telemetry.points.length, 1);
  applyFrame(s, frame(605, { players: frame(605).players.slice(0, 6) }));
  assert.equal(s.match.players.length, 12);
  assert.equal(s.match.metricFrame.teams, null);
  assert.equal(s.match.telemetry.points.at(-1).teams, null);
  applyFrame(s, frame(610));
  assert.deepEqual(
    soulsSegments(s.match.telemetry).map((p) => p.length),
    [1, 1],
  );
  applyFrame(s, frame(500));
  assert.equal(s.match.telemetry.points.at(-1).time, 610);
});
test("zero is observed and missing fields stay unknown instead of using merged totals", () => {
  const s = emptySession("2"),
    first = frame(0);
  applyFrame(s, first);
  const baseline = captureBaseline(s.match);
  assert.equal(baseline.players[0].damage, 0);
  const next = frame(10);
  next.players[0].damage = null;
  applyFrame(s, next);
  assert.equal(s.match.players[0].damage, 0);
  assert.equal(changesSince(s.match, baseline).get("1").damage, null);
  assert.equal(s.match.metricFrame.teams[0].damage, null);
  assert.equal(changesSince(s.match, baseline).get("2").damage, 1000);
});
test("current totals never reuse retained values for omitted fields or players", () => {
  const s = emptySession("6");
  applyFrame(s, frame(60));
  const partial = frame(65);
  partial.players = partial.players.slice(0, 11);
  delete partial.players[0].souls;
  delete partial.players[0].damage;
  applyFrame(s, partial);
  assert.equal(s.match.players.length, 12);
  assert.equal(s.match.players[0].souls, 1600);
  assert.equal(s.match.players[0].damage, 6000);
  const rows = currentMetricRows(s.match);
  assert.equal(rows.get("1").souls, null);
  assert.equal(rows.get("1").damage, null);
  assert.equal(rows.get("2").damage, 6500);
  assert.equal(rows.has("12"), false);
  assert.equal(currentMetricRows({ players: s.match.players }).size, 0);
});

test("from-now comparisons fence identity changes, backwards clocks and counter resets", () => {
  const s = emptySession("3");
  applyFrame(s, frame(60));
  const baseline = captureBaseline(s.match);
  applyFrame(s, frame(65));
  assert.equal(changesSince(s.match, baseline).get("1").kills, 1);
  const changed = frame(70);
  changed.players[0].id = "99";
  applyFrame(s, changed);
  assert.equal(changesSince(s.match, baseline), null);
  applyFrame(s, frame(20));
  assert.equal(changesSince(s.match, baseline), null);
  const reset = frame(75);
  reset.players[0].damage = 1;
  applyFrame(s, reset);
  assert.equal(changesSince(s.match, baseline).get("1").damage, null);
  assert.equal(
    cleanMetricsBaseline({
      ...baseline,
      players: baseline.players.slice(0, 6),
    }),
    null,
  );
});

test("window changes keep falling net worth signed, include buffs and reject an unknown source clock", () => {
  const s = emptySession("7");
  const start = frame(0);
  start.players.forEach((player) => {
    player.buffs = 1;
  });
  applyFrame(s, start);
  const baseline = captureBaseline(s.match);
  const next = frame(5);
  next.players.forEach((player) => {
    player.buffs = 3;
  });
  next.players[0].souls = 900;
  applyFrame(s, next);
  assert.equal(changesSince(s.match, baseline).get("1").souls, -100);
  assert.equal(changesSince(s.match, baseline).get("1").buffs, 2);
  s.match.metricFrame.time = null;
  assert.equal(changesSince(s.match, baseline), null);
});
test("net worth growth uses source seconds and allows a real negative net change", () => {
  const s = emptySession("4");
  for (let time = 0; time <= 60; time += 5) applyFrame(s, frame(time));
  assert.equal(netWorthRates(s.match).get("1").value, 600);
  const drop = frame(65);
  drop.players[0].souls = 100;
  applyFrame(s, drop);
  assert.equal(netWorthRates(s.match).get("1").value, -950);
  applyFrame(s, frame(70, { players: frame(70).players.slice(0, 8) }));
  assert.equal(netWorthRates(s.match).size, 0);
  applyFrame(s, frame(75));
  assert.equal(netWorthRates(s.match).size, 0);
});
test("bounded history survives result publication without later mutation", () => {
  let history;
  for (let index = 0; index < TELEMETRY_LIMIT + 3; index++)
    history = recordTelemetry(history, metricFrame(frame(index * 5)));
  assert.equal(history.points.length, TELEMETRY_LIMIT);
  assert.equal(history.points[0].time, 15);
  assert.ok(JSON.stringify(history).length < 200000);
  const s = emptySession("5");
  applyFrame(s, frame(20));
  applyFrame(s, frame(23, { endObserved: true, winner: 0 }));
  assert.equal(s.result.match.telemetry.points.at(-1).time, 23);
  const published = publishResult(s, { winner: 0 });
  s.result.match.telemetry.points[0].teams[0].souls = 999;
  assert.notEqual(published.match.telemetry.points[0].teams[0].souls, 999);
  applyFrame(s, frame(100));
  assert.equal(s.result.match.duration, 23);
});
test("graph gap threshold follows declared metadata sample cadence", () => {
  const history = {
    interval: 60,
    points: [0, 60, 120, 420, 480].map((time) => metricFrame(frame(time))),
  };
  assert.deepEqual(
    soulsSegments(history).map((segment) => segment.length),
    [3, 2],
  );
});

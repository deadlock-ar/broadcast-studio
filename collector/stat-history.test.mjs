import test from "node:test";
import assert from "node:assert/strict";
import { metricFrame, METRIC_FIELDS, TELEMETRY_LIMIT } from "./telemetry.mjs";
import {
  collectorSessionView,
  recordStatHistory,
  selectStatBaseline,
  statHistoryRange,
} from "./stat-history.mjs";

const now = 100000;
const frame = (time) =>
  metricFrame({
    duration: time,
    players: Array.from({ length: 12 }, (_, index) => ({
      id: String(index + 1),
      team: index < 6 ? 0 : 1,
      souls: 1000 + time * 10,
      damage: time * 100,
      objectiveDamage: time * 4,
      healing: time * 2,
      kills: Math.floor(time / 5),
      deaths: Math.floor(time / 15),
      assists: Math.floor(time / 10),
      buffs: Math.floor(time / 20),
    })),
  });
function sessionAt(time = 180) {
  let statHistory;
  for (let at = 0; at <= time; at += 5)
    statHistory = recordStatHistory(statHistory, frame(at));
  return {
    id: "123",
    status: "live",
    updatedAt: now,
    settings: {},
    statHistory,
    match: { id: "123", metricFrame: frame(time) },
  };
}

test("compact history retains eight raw metrics at five-second cadence and ignores backward frames", () => {
  const first = frame(10);
  first.players[0].healing = null;
  let history = recordStatHistory(null, first);
  assert.equal(history.points[0][1][0].length, 10);
  assert.equal(
    history.points[0][1][0][METRIC_FIELDS.indexOf("healing") + 2],
    null,
  );
  assert.deepEqual(history.fields, METRIC_FIELDS);
  assert.equal(recordStatHistory(history, frame(11)), history);
  assert.equal(recordStatHistory(history, frame(9), true), history);
  history = recordStatHistory(history, frame(15));
  assert.equal(history.points.length, 2);
  const replacement = frame(15);
  replacement.players[0].damage = 1999;
  const final = recordStatHistory(history, replacement, true);
  assert.equal(final.points.length, 2);
  assert.equal(
    final.points[1][1][0][METRIC_FIELDS.indexOf("damage") + 2],
    1999,
  );
  assert.equal(
    history.points[1][1][0][METRIC_FIELDS.indexOf("damage") + 2],
    1500,
  );
  assert.equal(recordStatHistory(final, frame(17), true).points.at(-1)[0], 17);
});

test("history is bounded independently of match and published snapshots", () => {
  let history;
  for (let index = 0; index < TELEMETRY_LIMIT + 10; index++)
    history = recordStatHistory(history, frame(index * 5));
  assert.equal(history.points.length, TELEMETRY_LIMIT);
  assert.equal(history.points[0][0], 50);
  assert.deepEqual(statHistoryRange(history), {
    first: 50,
    last: (TELEMETRY_LIMIT + 9) * 5,
    interval: 5,
  });
  assert.ok(JSON.stringify(history).length < 2000000);
});

test("server-held historical starts select the last measured sample at or before the requested source time", () => {
  const session = sessionAt();
  assert.equal(
    selectStatBaseline(session, { lookbackSeconds: 60 }, now).time,
    120,
  );
  const chosen = selectStatBaseline(session, { startTime: 87 }, now);
  assert.equal(chosen.time, 85);
  assert.equal(chosen.players[0].damage, 8500);
  assert.equal(chosen.players[0].buffs, 4);
  assert.equal(selectStatBaseline(session, { from: "now" }, now).time, 180);
  session.match.metricFrame = frame(183);
  assert.equal(selectStatBaseline(session, { from: "now" }, now).time, 183);
  assert.equal(selectStatBaseline(session, { startTime: 182 }, now).time, 180);
  assert.equal(
    selectStatBaseline(session, { lookbackSeconds: 0 }, now).time,
    183,
  );
  chosen.players[0].damage = 1;
  assert.equal(
    selectStatBaseline(session, { startTime: 87 }, now).players[0].damage,
    8500,
  );
});

test("bad request combinations, negative times, future starts and missing source history are rejected", () => {
  const session = sessionAt();
  for (const request of [
    null,
    [],
    {},
    { from: "later" },
    { from: "now", startTime: 50 },
    { startTime: -1 },
    { startTime: 181 },
    { startTime: "60" },
    { lookbackSeconds: -1 },
    { lookbackSeconds: 181 },
    { lookbackSeconds: Infinity },
    { unexpected: 60 },
  ])
    assert.throws(() => selectStatBaseline(session, request, now));
  const joined = sessionAt();
  joined.statHistory = recordStatHistory(null, frame(120));
  assert.throws(
    () => selectStatBaseline(joined, { startTime: 60 }, now),
    /No complete observation/,
  );
  assert.throws(
    () => selectStatBaseline(joined, { startTime: 126 }, now),
    /No complete observation/,
  );
  // Graph-only souls samples are not eight-metric history.
  joined.statHistory = {
    version: 1,
    interval: 5,
    points: [{ time: 60, players: frame(60).players }],
  };
  assert.throws(
    () => selectStatBaseline(joined, { startTime: 60 }, now),
    /No complete observation/,
  );
});

test("the fresh current observation wins timestamp ties for now and zero-lookback starts", () => {
  const session = sessionAt();
  session.match.metricFrame.players[0].damage = 18009;
  session.match.metricFrame.players[0].buffs = 10;
  for (const request of [
    { from: "now" },
    { lookbackSeconds: 0 },
    { startTime: 180 },
  ]) {
    const chosen = selectStatBaseline(session, request, now);
    assert.equal(chosen.time, 180);
    assert.equal(chosen.players[0].damage, 18009);
    assert.equal(chosen.players[0].buffs, 10);
  }
  assert.equal(
    selectStatBaseline(session, { startTime: 175 }, now).players[0].damage,
    17500,
  );
});

test("partial raw observations never invent values or promote an incomplete lineup", () => {
  const session = sessionAt();
  const partialMetric = frame(120);
  partialMetric.players[0].damage = null;
  session.statHistory = recordStatHistory(null, partialMetric);
  const chosen = selectStatBaseline(session, { startTime: 120 }, now);
  assert.equal(chosen.players[0].damage, null);
  assert.equal(chosen.players[0].healing, 240);
  const missingPlayer = frame(120);
  missingPlayer.players.pop();
  session.statHistory = recordStatHistory(null, missingPlayer);
  assert.throws(
    () => selectStatBaseline(session, { startTime: 120 }, now),
    /No complete observation/,
  );
  session.match.metricFrame = metricFrame({
    duration: 180,
    players: frame(180).players.slice(0, 11),
  });
  assert.throws(
    () => selectStatBaseline(session, { from: "now" }, now),
    /complete twelve-player/,
  );
});

test("selection fences stale streams, changed teams and backwards replay clocks", () => {
  const session = sessionAt();
  assert.throws(
    () => selectStatBaseline(session, { startTime: 60 }, now + 15001),
    /fresh live/,
  );
  assert.throws(
    () => selectStatBaseline(session, { from: "now" }, now - 1),
    /fresh live/,
  );
  session.status = "interrupted";
  assert.throws(
    () => selectStatBaseline(session, { startTime: 60 }, now),
    /fresh live/,
  );
  session.status = "live";
  const switched = frame(180);
  [switched.players[0].team, switched.players[6].team] = [1, 0];
  session.match.metricFrame = switched;
  assert.throws(
    () => selectStatBaseline(session, { startTime: 60 }, now),
    /recorded lineup differs/,
  );
  session.match.metricFrame = frame(175);
  assert.throws(
    () => selectStatBaseline(session, { startTime: 60 }, now),
    /source clock moved backwards/,
  );
});

test("finished games can select their observed history without a recent wall-clock update", () => {
  const session = sessionAt();
  session.result = { match: session.match };
  session.status = "finished";
  session.updatedAt = 1;
  assert.equal(
    selectStatBaseline(session, { lookbackSeconds: 60 }, now).time,
    120,
  );
  session.result.match.metricFrame = frame(null);
  assert.throws(
    () => selectStatBaseline(session, { startTime: 60 }, now),
    /complete twelve-player/,
  );
});

test("collector transport strips history while retaining the session and advertising only available times", () => {
  const session = sessionAt();
  session.result = { match: { players: [{ id: "1", damage: 100 }] } };
  session.published = { mvpId: "1" };
  const before = structuredClone(session);
  const view = collectorSessionView(session);
  assert.equal(Object.hasOwn(view, "statHistory"), false);
  assert.equal(view.result, session.result);
  assert.equal(view.published, session.published);
  assert.deepEqual(view.statHistoryRange, { first: 0, last: 180, interval: 5 });
  assert.ok(JSON.stringify(view).length < JSON.stringify(session).length / 5);
  assert.deepEqual(session, before);
  assert.equal(collectorSessionView(null), null);
  assert.equal(collectorSessionView({ id: "old" }).statHistoryRange, null);
});

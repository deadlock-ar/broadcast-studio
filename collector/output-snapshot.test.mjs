import test from "node:test";
import assert from "node:assert/strict";
import { publicCollectorMatch } from "./output-snapshot.mjs";
import { metricFrame, netWorthRates, soulsSegments } from "./telemetry.mjs";

function matchAt(time = 120) {
  const sample = (at) =>
    metricFrame({
      duration: at,
      players: Array.from({ length: 12 }, (_, i) => ({
        id: String(i + 1),
        team: i < 6 ? 0 : 1,
        souls: 1000 + at * (i < 6 ? 10 : 8),
        damage: at * 20,
      })),
    });
  return {
    id: "123",
    duration: time,
    players: [{ id: "1", name: "Caster test", items: [99] }],
    metricFrame: sample(time),
    telemetry: {
      version: 1,
      interval: 5,
      sourceDetails: { internal: true },
      points: Array.from({ length: time / 5 + 1 }, (_, i) => ({
        ...sample(i * 5),
        sourceDetails: { internal: true },
      })),
    },
  };
}

test("stat and ultimate outputs omit history without changing the source or final result", () => {
  const match = matchAt(),
    original = structuredClone(match);
  for (const channel of ["deadem", "ultimates"]) {
    const output = publicCollectorMatch(match, channel);
    assert.equal(Object.hasOwn(output, "telemetry"), false);
    assert.equal(Object.hasOwn(output, "metricFrame"), channel === "deadem");
    if (channel === "deadem") {
      assert.deepEqual(output.metricFrame, match.metricFrame);
      output.metricFrame.players[0].souls = 1;
    }
    assert.deepEqual(output.players, match.players);
    output.players[0].items.push(100);
    assert.deepEqual(match, original);
  }
  assert.equal(publicCollectorMatch(null, "momentum"), null);
});

test("stat-window output rejects an older raw observation without repeating history", () => {
  const match = matchAt();
  match.metricFrame.time = 100;
  const output = publicCollectorMatch(match, "deadem");
  assert.equal(output.metricFrame, null);
  assert.equal(Object.hasOwn(output, "telemetry"), false);
  assert.equal(match.metricFrame.time, 100);
});

test("momentum keeps graph coverage and rate math with only recent player souls", () => {
  const match = matchAt(),
    original = structuredClone(match);
  const output = publicCollectorMatch(match, "momentum");
  assert.deepEqual(
    soulsSegments(output.telemetry),
    soulsSegments(match.telemetry),
  );
  assert.deepEqual(netWorthRates(output), netWorthRates(match));
  assert.equal(Object.hasOwn(output.telemetry, "sourceDetails"), false);
  for (const point of output.telemetry.points) {
    assert.equal(Object.hasOwn(point, "sourceDetails"), false);
    assert.deepEqual(Object.keys(point.teams[0]), ["souls"]);
    if (point.time < 55) assert.equal(Object.hasOwn(point, "players"), false);
    else
      assert.deepEqual(Object.keys(point.players[0]), ["id", "team", "souls"]);
  }
  output.metricFrame.players[0].souls = 1;
  output.telemetry.points.at(-1).teams[0].souls = 1;
  output.telemetry.points.at(-1).players[0].souls = 1;
  assert.deepEqual(match, original);
});

test("projection preserves missing observations and does not erase a graph gap", () => {
  const match = matchAt();
  match.telemetry.points[12].teams = null;
  match.telemetry.points[13].teams[0].souls = null;
  const output = publicCollectorMatch(match, "momentum");
  assert.equal(output.telemetry.points[12].teams, null);
  assert.equal(output.telemetry.points[13].teams[0].souls, null);
  assert.deepEqual(
    soulsSegments(output.telemetry),
    soulsSegments(match.telemetry),
  );
  assert.equal(netWorthRates(output).size, 0);
});

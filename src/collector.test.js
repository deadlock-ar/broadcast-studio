import test from "node:test";
import assert from "node:assert/strict";
import {
  collectorOverlayUrl,
  visibleUltimateBadges,
  enqueueCollectorState,
  liveRoster,
  collectorRenderNow,
  collectorFreshAt,
} from "./collector.js";
test("portrait calibration reorders within teams without changing player identity", () => {
  const session = {
    settings: { hudOrder: ["2", "1", "3"] },
    match: {
      players: [
        { id: "1", team: 0, slot: 0 },
        { id: "2", team: 0, slot: 1 },
        { id: "3", team: 1, slot: 2 },
      ],
    },
  };
  assert.deepEqual(
    liveRoster(session).map((p) => p.id),
    ["2", "1", "3"],
  );
  session.settings.hudOrder = ["3", "2", "1"];
  assert.deepEqual(
    liveRoster(session).map((p) => p.id),
    ["2", "1", "3"],
  );
});
test("recording-timeline target smooths arrival bursts with a stable clock offset", () => {
  const clock = {};
  const sample = (sourceAt, sentAt, duration = 50) => ({
    id: "game",
    status: "live",
    updatedAt: sentAt,
    settings: { delayMs: 5000 },
    match: { duration },
    sourceTiming: {
      basis: "recording-timeline",
      timelineId: "one",
      sourceAt,
      sentAt,
    },
  });
  let queue = enqueueCollectorState(
    [],
    sample(10000, 12000),
    22000,
    5000,
    100,
    clock,
  );
  queue = enqueueCollectorState(
    queue,
    sample(10250, 12000),
    22010,
    5000,
    100,
    clock,
  );
  queue = enqueueCollectorState(
    queue,
    sample(10500, 14000),
    24000,
    5000,
    100,
    clock,
  );
  assert.deepEqual(
    queue.map((entry) => entry.at),
    [25000, 25250, 25500],
  );
  assert.equal(collectorRenderNow(queue[1].value, 25250), 10250);
  assert.equal(collectorFreshAt(queue[1].value), 10250);
  // Paused game duration does not stop the independent recording timeline.
  queue = enqueueCollectorState(
    queue,
    sample(10750, 14000),
    24010,
    5000,
    100,
    clock,
  );
  assert.equal(queue.at(-1).at, 25750);
});
test("late samples, source resets, replayed older samples and legacy fallback stay bounded", () => {
  const clock = {};
  const timed = (sourceAt, timelineId = "one") => ({
    id: "game",
    sourceTiming: {
      basis: "recording-timeline",
      timelineId,
      sourceAt,
      sentAt: 10000,
    },
  });
  let queue = enqueueCollectorState([], timed(10000), 20000, 5000, 100, clock);
  queue = enqueueCollectorState(queue, timed(10500), 30000, 5000, 100, clock);
  assert.equal(queue.at(-1).at, 30000);
  assert.equal(queue.at(-1).value.playout.lateByMs, 4500);
  assert.equal(
    enqueueCollectorState(queue, timed(10000), 30010, 5000, 100, clock).length,
    queue.length,
  );
  queue = enqueueCollectorState(
    queue,
    timed(9000, "two"),
    30020,
    5000,
    100,
    clock,
  );
  assert.equal(queue.length, 1);
  const legacy = enqueueCollectorState([], { id: "old" }, 10000, 5000);
  assert.equal(legacy[0].at, 15000);
  assert.equal(legacy[0].value.playout.mode, "receipt");
});
test("a long broadcast delay remains deliverable during rapid event bursts", () => {
  let queue = [];
  for (let now = 0; now < 120000; now += 10)
    queue = enqueueCollectorState(queue, { now }, now, 120000);
  assert.ok(queue.length <= 1200);
  assert.ok(queue[0].at < 120100);
  assert.equal(queue.at(-1).value.now, 119990);
});
test("HUD badges expire, deduplicate an ongoing effect, and disappear when the feed is stale or interrupted", () => {
  const hit = {
    targetId: "1",
    abilityId: 99,
    kind: "hit",
    at: 1000,
    durationMs: 1600,
  };
  const s = {
    status: "live",
    updatedAt: 1100,
    effects: [{ ...hit, kind: "effect" }],
    recentHits: [hit],
  };
  assert.equal(visibleUltimateBadges(s, 1200).length, 1);
  assert.equal(visibleUltimateBadges(s, 1200)[0].kind, "effect");
  assert.equal(visibleUltimateBadges({ ...s, effects: [] }, 3000).length, 1);
  assert.equal(visibleUltimateBadges({ ...s, effects: [] }, 4000).length, 0);
  assert.equal(visibleUltimateBadges(s, 12000).length, 0);
  assert.equal(
    visibleUltimateBadges({ ...s, status: "interrupted" }, 1200).length,
    0,
  );
});
test("OBS links target the same local collector and pin a specific match", () => {
  const url = new URL(collectorOverlayUrl("ultimate-hud", "123"));
  assert.equal(url.origin, "http://127.0.0.1:8766");
  assert.equal(url.searchParams.get("match"), "123");
  assert.equal(url.searchParams.get("view"), "ultimate-hud");
});

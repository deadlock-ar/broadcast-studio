import test from "node:test";
import assert from "node:assert/strict";
import {
  collectorOverlayUrl,
  visibleUltimateBadges,
  enqueueCollectorState,
  liveRoster,
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
  assert.equal(visibleUltimateBadges({ ...s, effects: [] }, 3000).length, 0);
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

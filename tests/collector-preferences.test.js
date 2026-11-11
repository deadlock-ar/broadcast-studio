import test from "node:test";
import assert from "node:assert/strict";
import {
  collectorUltimatePreferences,
  applyCollectorUltimatePreferences,
} from "../src/collector-preferences.js";
import {
  enqueueCollectorState,
  collectorRenderNow,
  visibleUltimateBadges,
} from "../src/collector.js";

const session = (values = {}) => ({
  id: "game-a",
  status: "live",
  updatedAt: 10000,
  match: { duration: 90 },
  settings: {
    delayMs: 120000,
    names: { 1: "Displayed name" },
    ultimateBadges: { enabled: true },
  },
  effects: [{ targetId: "1", abilityId: 99, kind: "effect" }],
  recentHits: [
    { targetId: "1", abilityId: 100, kind: "hit", at: 10000, durationMs: 1600 },
  ],
  sourceTiming: {
    basis: "recording-timeline",
    timelineId: "timeline-a",
    sourceAt: 10000,
    sentAt: 10000,
  },
  ...values,
});

test("master and per-ultimate switches apply immediately and survive older delayed frames", () => {
  const original = session();
  const packet = { visible: true, session: original };
  const queued = enqueueCollectorState([], packet, 110000, 120000, 100, {});
  const displayed = queued[0].value;
  assert.equal(queued[0].at, 230000);
  const before = structuredClone(displayed);
  for (const ultimateBadges of [
    { enabled: false },
    { enabled: true, byAbility: { 99: { effect: false } } },
  ]) {
    const currentControl = session({
      settings: { delayMs: 0, names: { 1: "Future name" }, ultimateBadges },
      match: { duration: 300 },
      recentHits: [],
    });
    const preferences = collectorUltimatePreferences(currentControl);
    const immediate = applyCollectorUltimatePreferences(displayed, preferences);
    assert.deepEqual(
      immediate.session.settings.ultimateBadges,
      preferences.ultimateBadges,
    );
    assert.strictEqual(immediate.session.match, displayed.session.match);
    assert.strictEqual(immediate.session.effects, displayed.session.effects);
    assert.strictEqual(
      immediate.session.recentHits,
      displayed.session.recentHits,
    );
    assert.strictEqual(
      immediate.session.sourceTiming,
      displayed.session.sourceTiming,
    );
    assert.strictEqual(immediate.session.playout, displayed.session.playout);
    assert.strictEqual(
      immediate.session.settings.names,
      displayed.session.settings.names,
    );
    assert.equal(immediate.session.settings.delayMs, 120000);
    assert.equal(immediate.session.updatedAt, displayed.session.updatedAt);
    const released = applyCollectorUltimatePreferences(
      queued[0].value,
      preferences,
    );
    const now = collectorRenderNow(released.session, queued[0].at);
    const badges = visibleUltimateBadges(released.session, now);
    assert.equal(
      badges.some((badge) => badge.abilityId === 99),
      false,
    );
    if (ultimateBadges.enabled === false) assert.deepEqual(badges, []);
  }
  assert.deepEqual(displayed, before);
});

test("enabling indicators never borrows hits or match time from the latest packet", () => {
  const displayed = session({
    effects: [],
    recentHits: [],
    settings: { delayMs: 5000, ultimateBadges: { enabled: false } },
  });
  const latest = session({ match: { duration: 200 } });
  const projected = applyCollectorUltimatePreferences(
    displayed,
    collectorUltimatePreferences(latest),
  );
  assert.deepEqual(visibleUltimateBadges(projected, 11000), []);
  assert.equal(projected.match.duration, 90);
  assert.strictEqual(projected.effects, displayed.effects);
  assert.strictEqual(projected.recentHits, displayed.recentHits);
  assert.equal(projected.settings.delayMs, 5000);
});

test("preferences are scoped to the selected session and unrelated/default updates preserve identity", () => {
  const displayed = session();
  const other = session({
    id: "game-b",
    settings: { ultimateBadges: { enabled: false } },
  });
  assert.equal(collectorUltimatePreferences(other, "game-a"), null);
  assert.strictEqual(
    applyCollectorUltimatePreferences(
      displayed,
      collectorUltimatePreferences(other),
    ),
    displayed,
  );
  assert.strictEqual(
    applyCollectorUltimatePreferences(displayed, null),
    displayed,
  );
  assert.strictEqual(
    applyCollectorUltimatePreferences(
      displayed,
      collectorUltimatePreferences(displayed),
    ),
    displayed,
  );
  assert.equal(collectorUltimatePreferences({ session: null }), null);
});

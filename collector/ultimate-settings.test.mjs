import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanUltimateBadges,
  ultimateCapabilities,
  ultimateBadgeAllowed,
  filterUltimateBadges,
} from "./ultimate-settings.mjs";
import { cleanSettings, emptySession } from "./model.mjs";
import {
  visibleUltimateBadges,
  enqueueCollectorState,
  collectorRenderNow,
} from "../src/collector.js";

const hit = (values = {}) => ({
  targetId: "player",
  abilityId: 99,
  kind: "hit",
  at: 10000,
  durationMs: 1600,
  ...values,
});
const session = (values = {}) => ({
  status: "live",
  updatedAt: 10000,
  recentHits: [hit()],
  effects: [],
  ...values,
});

test("legacy/default settings preserve detected indicators and size/count limits are validated", () => {
  assert.deepEqual(cleanUltimateBadges(), {
    enabled: true,
    iconSize: 32,
    maxPerPlayer: 4,
    byAbility: {},
  });
  const settings = cleanUltimateBadges({
    enabled: false,
    iconSize: 100,
    maxPerPlayer: 6,
    byAbility: {
      99: { hit: false, effect: true },
      100: { hit: true, effect: true },
      bad: { effect: false },
    },
  });
  assert.deepEqual(settings, {
    enabled: false,
    iconSize: 48,
    maxPerPlayer: 4,
    byAbility: { 99: { hit: false, effect: true } },
  });
  assert.equal(cleanUltimateBadges({ iconSize: -1 }).iconSize, 12);
  assert.equal(
    cleanUltimateBadges({ iconSize: NaN, maxPerPlayer: 2 }).iconSize,
    32,
  );
  assert.equal(emptySession("1").settings.ultimateBadges.enabled, true);
  const previous = cleanSettings({ ultimateBadges: settings });
  assert.deepEqual(
    cleanSettings({ hud: { x: 100 } }, previous).ultimateBadges,
    settings,
  );
});

test("master and each kind are independent; disabling an effect reveals an enabled simultaneous hit", () => {
  const s = session({ effects: [hit({ kind: "effect" })] });
  assert.equal(visibleUltimateBadges(s, 11000)[0].kind, "effect");
  s.settings = { ultimateBadges: { byAbility: { 99: { effect: false } } } };
  assert.equal(visibleUltimateBadges(s, 11000)[0].kind, "hit");
  s.settings.ultimateBadges.byAbility[99] = { hit: false };
  assert.equal(visibleUltimateBadges(s, 11000)[0].kind, "effect");
  s.settings.ultimateBadges.enabled = false;
  assert.deepEqual(visibleUltimateBadges(s, 11000), []);
  assert.equal(s.settings.ultimateBadges.byAbility[99].hit, false);
});

test("damage badge holds through2600ms, fades on its source clock and is gone at2900ms", () => {
  const s = session();
  assert.equal(visibleUltimateBadges(s, 12600)[0].opacity, 1);
  assert.equal(visibleUltimateBadges(s, 12600)[0].phase, "hold");
  assert.equal(visibleUltimateBadges(s, 12750)[0].opacity, 0.5);
  assert.equal(visibleUltimateBadges(s, 12750)[0].phase, "fade");
  assert.ok(visibleUltimateBadges(s, 12899)[0].opacity > 0);
  assert.deepEqual(visibleUltimateBadges(s, 12900), []);
  assert.deepEqual(visibleUltimateBadges(s, 9999), []);
});

test("repeated snapshots do not restart a hit; a newer real hit refreshes its target badge", () => {
  const s = session({ recentHits: [hit(), hit({ at: 12000 })] });
  assert.equal(visibleUltimateBadges(s, 14500)[0].at, 12000);
  assert.equal(visibleUltimateBadges(s, 14500)[0].opacity, 1);
  assert.equal(visibleUltimateBadges(s, 14750)[0].opacity, 0.5);
  assert.equal(visibleUltimateBadges(s, 14750)[0].opacity, 0.5);
});

test("lasting effects do not inherit the damage hold or fade and clear with their source", () => {
  const s = session({ effects: [hit({ kind: "effect", duration: 0.5 })] });
  const active = visibleUltimateBadges(s, 15000);
  assert.equal(active.length, 1);
  assert.equal(active[0].kind, "effect");
  assert.equal(active[0].opacity, undefined);
  assert.deepEqual(visibleUltimateBadges({ ...s, effects: [] }, 15000), []);
});

test("presentation lifetime respects timeline delay and client clock offset", () => {
  const s = session({
    sourceTiming: {
      basis: "recording-timeline",
      timelineId: "one",
      sourceAt: 10000,
      sentAt: 10000,
    },
  });
  const queue = enqueueCollectorState([], s, 110000, 5000, 100, {});
  const renderNow = collectorRenderNow(queue[0].value, 117750, true);
  assert.equal(renderNow, 12750);
  assert.equal(
    visibleUltimateBadges(queue[0].value, renderNow)[0].opacity,
    0.5,
  );
});

test("preview filters enforce supported kinds and per-player maximum without manufacturing interactions", () => {
  const catalog = [
    { id: 99, modifiers: [7] },
    { id: 100, modifiers: [] },
    { id: 4110547059, modifiers: [] },
  ];
  assert.deepEqual(ultimateCapabilities(catalog[1]), {
    hit: true,
    effect: false,
  });
  assert.deepEqual(ultimateCapabilities(catalog[2]), {
    hit: false,
    effect: false,
  });
  assert.equal(
    ultimateBadgeAllowed({}, hit({ abilityId: 100, kind: "effect" }), catalog),
    false,
  );
  assert.equal(
    ultimateBadgeAllowed({}, hit({ abilityId: 4110547059 }), catalog),
    false,
  );
  assert.equal(
    ultimateBadgeAllowed({}, hit({ abilityId: 777 }), catalog),
    false,
  );
  const badges = [
    hit(),
    hit({ abilityId: 100 }),
    hit({ targetId: "other" }),
    hit({ targetId: "other", abilityId: 100 }),
  ];
  assert.deepEqual(
    filterUltimateBadges(badges, { maxPerPlayer: 1 }, catalog).map(
      (b) => b.targetId,
    ),
    ["player", "other"],
  );
  assert.deepEqual(
    filterUltimateBadges(badges, { enabled: false }, catalog),
    [],
  );
});

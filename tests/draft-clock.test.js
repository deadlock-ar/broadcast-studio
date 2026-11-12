import test from "node:test";
import assert from "node:assert/strict";
import {
  advanceDraftClock,
  draftClockLabel,
  draftClockTime,
  DRAFT_CLOCK_HANDOFF_MS,
} from "../src/draft-clock.js";
const teams = [{ name: "Amber" }, { name: "Sapphire" }];
const snapshot = (step = 0, timer = null) => ({
  draftCode: "ROOM1234",
  status: "ACTIVE",
  currentStepIndex: step,
  steps: [
    { id: "one", teamNumber: 1, selectionType: "ban" },
    { id: "two", teamNumber: 2, selectionType: "pick" },
    { id: "three", teamNumber: 2, selectionType: "pick" },
  ],
  currentTimer: timer,
});
const clock = (team, seconds, reserve) => ({
  activeTeam: team,
  [`team${team}StepTimer`]: seconds,
  [`team${team}ReserveTimer`]: reserve,
});

test("a turn handoff holds both numbers and their original team label until the new timer arrives", () => {
  const first = advanceDraftClock(null, snapshot(0, clock(1, 12, 90)), true, 0);
  const gap = advanceDraftClock(first, snapshot(1), true, 100);
  assert.equal(gap.frame.seconds, 12);
  assert.equal(gap.frame.reserve, 90);
  assert.equal(draftClockLabel(gap.frame.phase, teams), "Amber banning");
  assert.equal(gap.pendingUntil, 2100);
  const switched = advanceDraftClock(
    gap,
    snapshot(1, clock(2, 30, 120)),
    true,
    1100,
  );
  assert.equal(switched.pendingUntil, null);
  assert.equal(switched.frame.seconds, 30);
  assert.equal(switched.frame.reserve, 120);
  assert.equal(
    draftClockLabel(switched.frame.phase, teams),
    "Sapphire picking",
  );
  const tick = advanceDraftClock(
    switched,
    snapshot(1, clock(2, 29, 120)),
    true,
    1200,
  );
  assert.equal(tick.frame.turn, switched.frame.turn); // One entrance per turn, not every second.
});

test("same-team consecutive picks also hold through the empty timer packet", () => {
  const first = advanceDraftClock(null, snapshot(1, clock(2, 5, 95)), true, 0);
  const gap = advanceDraftClock(first, snapshot(2), true, 100);
  assert.deepEqual(gap.frame, first.frame);
  const next = advanceDraftClock(
    gap,
    snapshot(2, clock(2, 30, 95)),
    true,
    1100,
  );
  assert.notEqual(next.frame.turn, first.frame.turn);
  assert.equal(next.frame.seconds, 30);
});

test("repeated missing or old-team timers never extend the two-second handoff", () => {
  let state = advanceDraftClock(null, snapshot(0, clock(1, 0, 120)), true, 0);
  state = advanceDraftClock(state, snapshot(1, clock(1, 0, 120)), true, 100);
  assert.equal(state.frame.seconds, 0);
  const until = state.pendingUntil;
  state = advanceDraftClock(state, snapshot(1), true, 1900);
  assert.equal(state.pendingUntil, until);
  state = advanceDraftClock(
    state,
    state.snapshot,
    true,
    100 + DRAFT_CLOCK_HANDOFF_MS,
  );
  assert.equal(state.frame, null);
  state = advanceDraftClock(state, snapshot(1), true, 5000);
  assert.equal(state.frame, null);
});

test("room changes, rematches, pause, finish and disconnect clear the held clock immediately", () => {
  const first = advanceDraftClock(null, snapshot(1, clock(2, 19, 88)), true, 0);
  for (const [next, connected] of [
    [{ ...snapshot(2), draftCode: "OTHER123" }, true],
    [snapshot(0), true],
    [{ ...snapshot(2), status: "PAUSED" }, true],
    [{ ...snapshot(2), status: "COMPLETED" }, true],
    [snapshot(2), false],
  ])
    assert.equal(advanceDraftClock(first, next, connected, 10).frame, null);
});

test("partial same-turn packets preserve reserve; another turn never borrows the old reserve", () => {
  const first = advanceDraftClock(null, snapshot(1, clock(2, 19, 88)), true, 0);
  const partial = advanceDraftClock(
    first,
    snapshot(1, { activeTeam: "2", team2StepTimer: 18 }),
    true,
    100,
  );
  assert.equal(partial.frame.reserve, 88);
  const next = advanceDraftClock(
    partial,
    snapshot(2, { activeTeam: 2, team2StepTimer: 30 }),
    true,
    200,
  );
  assert.equal(next.frame.reserve, null);
  assert.equal(next.frame.seconds, 30);
});

test("clock formatting keeps zero honest and never creates a countdown for missing data", () => {
  assert.equal(draftClockTime(0), "0:00");
  assert.equal(draftClockTime(61.9), "1:01");
  assert.equal(draftClockTime(null), "—");
  assert.equal(draftClockTime(NaN), "—");
  assert.equal(advanceDraftClock(null, snapshot(), true, 0).frame, null);
});

test("a paused draft still displays its valid frozen source timer", () => {
  const paused = { ...snapshot(1, clock(2, 17, 89)), status: "PAUSED" };
  const state = advanceDraftClock(null, paused, true, 0);
  assert.equal(state.frame.seconds, 17);
  assert.equal(state.frame.reserve, 89);
  assert.equal(draftClockLabel(state.frame.phase, teams), "Draft paused");
  assert.equal(state.pendingUntil, null);
});

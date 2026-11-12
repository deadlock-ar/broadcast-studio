import test from "node:test";
import assert from "node:assert/strict";
import { settleEndFrame } from "./end-settlement.mjs";
const players = Array.from({ length: 12 }, (_, index) => ({
  id: String(index + 1),
  damage: index,
}));
test("game over waits for source-time grace and rejects transient reset clocks", () => {
  const state = {};
  settleEndFrame(state, { players, duration: 1800, endObserved: false }, 10000);
  assert.equal(
    settleEndFrame(state, { players, duration: 0, endObserved: true }, 10100)
      .endObserved,
    false,
  );
  assert.equal(
    settleEndFrame(state, { players, duration: 1, endObserved: true }, 10500)
      .endObserved,
    false,
  );
  assert.equal(
    settleEndFrame(state, { players, duration: 1801, endObserved: true }, 10600)
      .endObserved,
    false,
  );
  assert.equal(
    settleEndFrame(state, { players, duration: 1801, endObserved: true }, 11600)
      .endObserved,
    true,
  );
});
test("EOF can finalize the last complete roster with an explicit clock fallback", () => {
  const state = {};
  settleEndFrame(
    state,
    { players, duration: 1800.4, endObserved: false },
    10000,
  );
  settleEndFrame(state, { players, duration: 0, endObserved: true }, 10100);
  const result = settleEndFrame(
    state,
    { players: [], duration: 0, endObserved: true },
    10200,
    true,
  );
  assert.equal(result.players.length, 12);
  assert.equal(result.duration, 1800);
  assert.equal(result.durationEvidence, "last-observed-before-game-over");
  assert.equal(
    settleEndFrame(
      {},
      { players, duration: 10, endObserved: false },
      1000,
      true,
    ).endObserved,
    false,
  );
});

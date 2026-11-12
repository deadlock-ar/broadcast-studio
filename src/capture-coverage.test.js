import test from "node:test";
import assert from "node:assert/strict";
import { captureCoverage } from "./capture-coverage.js";

const players = () =>
  Array.from({ length: 12 }, (_, i) => ({
    id: String(i + 1),
    items: [],
    abilities: [0, 1, 2, 3].map((slot) => ({
      slot,
      level: null,
      unlocked: false,
    })),
    soulsBySource: [{ source: 2, gold: 0, complete: true }],
  }));
test("known empty inventories, locked abilities and zero source totals remain valid recorded data", () => {
  const coverage = captureCoverage({
    result: { match: { players: players() } },
    items: { fromStart: true, purchases: [] },
  });
  assert.equal(coverage.inventories, 12);
  assert.equal(coverage.abilityPlayers, 12);
  assert.equal(coverage.sourcePlayers, 12);
  assert.deepEqual(coverage.messages, []);
});
test("missing fields and uncertain purchases are visible before publishing without inventing zeroes", () => {
  const roster = players();
  roster[0].items = null;
  roster[1].abilities[0].unlocked = null;
  roster[2].soulsBySource = null;
  const coverage = captureCoverage({
    result: { match: { players: roster } },
    items: { purchases: [{ status: "review" }, { status: "confirmed" }] },
  });
  assert.equal(coverage.inventories, 11);
  assert.equal(coverage.abilityPlayers, 11);
  assert.equal(coverage.sourcePlayers, 11);
  assert.equal(coverage.unverifiedPurchases, 1);
  assert.ok(coverage.messages.some((m) => m.includes("automatically omitted")));
  assert.equal(roster[0].items, null);
});

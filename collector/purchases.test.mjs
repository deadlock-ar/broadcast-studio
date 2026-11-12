import test from "node:test";
import assert from "node:assert/strict";
import { PurchaseLedger } from "./purchases.mjs";
import {
  draftPriority,
  draftSelections,
  itemPriority,
} from "../src/analytics.js";
import { makeDemo, DRAFT_ORDER } from "../src/draft.js";
import { ultimateHit } from "./ultimates.mjs";

const make = () =>
  new PurchaseLedger([{ id: 1, cost: 800, name: "Test item" }]);
const actor = (refundable) =>
  new Map([[0, { id: "123", name: "Player", refundable }]]);
const buy = (l) => {
  l.record({ type: "notification", user: 0, itemId: 1, order: 1 });
  l.record({ type: "currency", user: 0, currencyType: 0, delta: -800 });
  l.flush(10, actor([1]));
};
test("full refunds are excluded and later partial sales retain the original purchase", () => {
  const l = make();
  buy(l);
  l.record({ type: "notification", user: 0, itemId: 1, sell: true });
  l.record({ type: "currency", user: 0, currencyType: 0, delta: 800 });
  l.flush(11, actor([1]));
  assert.equal(l.purchases[0].status, "refunded");
  buy(l);
  l.flush(20, actor([]));
  l.record({ type: "notification", user: 0, itemId: 1, sell: true });
  l.record({ type: "currency", user: 0, currencyType: 0, delta: 400 });
  l.flush(999, actor([]));
  assert.equal(l.purchases[1].status, "confirmed");
  assert.equal(
    itemPriority([{ purchases: l.purchases }], [{ id: 1 }])[0].total,
    1,
  );
});
test("missing refund signals create review rows rather than guessing by elapsed time", () => {
  const l = make();
  buy(l);
  l.record({ type: "notification", user: 0, itemId: 1, sell: true });
  l.flush(1000, actor(undefined));
  assert.equal(l.purchases[0].status, "review");
  assert.equal(itemPriority([{ purchases: l.purchases }]).length, 0);
});
test("purchase notifications and ability changes describe one transaction", () => {
  const l = make();
  l.record({ type: "notification", user: 0, itemId: 1, sell: false, order: 1 });
  l.record({ type: "change", user: 0, itemId: 1, sell: false, order: 2 });
  l.flush(10, actor([1]));
  assert.equal(l.purchases.length, 1);
  l.flush(100, actor([]));
  assert.equal(l.purchases[0].status, "confirmed");
});
test("a return without a recorded purchase does not manufacture a purchase", () => {
  const l = make();
  l.record({ type: "notification", user: 0, itemId: 1, sell: true });
  l.flush(10, actor([]));
  assert.equal(l.purchases.length, 0);
});
test("game end confirms retained purchases; stopping a recording does not", () => {
  const l = make();
  buy(l);
  l.flush(50, actor(undefined), false);
  assert.equal(l.purchases[0].status, "pending");
  l.flush(51, actor(undefined), true);
  assert.equal(l.purchases[0].status, "confirmed");
});
test("three-ban order and opening double pick match the supplied competitive sequence", () => {
  assert.deepEqual(DRAFT_ORDER, [
    [1, "ban"],
    [2, "ban"],
    [1, "ban"],
    [2, "ban"],
    [1, "pick"],
    [2, "pick"],
    [2, "pick"],
    [1, "pick"],
    [2, "pick"],
    [1, "pick"],
    [2, "ban"],
    [1, "ban"],
    [2, "pick"],
    [1, "pick"],
    [1, "pick"],
    [2, "pick"],
    [1, "pick"],
    [2, "pick"],
  ]);
  const d = makeDemo();
  d.steps.forEach((s, i) => (s.heroId = i + 1));
  const s = draftSelections(d);
  assert.deepEqual(
    s.filter((s) => s.firstRound).map((s) => s.order),
    [1, 2, 3, 4, 5, 6, 7],
  );
  const totals = draftPriority([{ snapshot: d }]);
  assert.equal(
    totals.reduce((n, r) => n + r.total, 0),
    18,
  );
});
test("item averages and rank changes use selected game cohorts", () => {
  const p = (id) => ({ itemId: id, status: "confirmed" });
  const rows = itemPriority(
    [{ purchases: [p(1), p(1), p(2)] }, { purchases: [p(1)] }],
    [
      { id: 1, name: "A" },
      { id: 2, name: "B" },
    ],
    [{ purchases: [p(2), p(1), p(2)] }],
  );
  assert.equal(rows[0].average, 1.5);
  assert.equal(rows[0].rankChange, 1);
  assert.equal(rows[0].averageChange, 0.5);
});
test("Graves second-ability zombie damage never becomes an ultimate hit badge", () => {
  assert.equal(
    ultimateHit(null, { abilityId: 4110547059, damage: 115 }, [
      { id: 4110547059 },
    ]),
    null,
  );
});

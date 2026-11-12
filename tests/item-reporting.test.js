import test from "node:test";
import assert from "node:assert/strict";
import {
  automaticItemHistory,
  itemReportDetails,
} from "../src/item-reporting.js";
import { itemPriority } from "../src/analytics.js";

const entry = (id, values = {}) => ({
  id: `metadata:123:player:${id}`,
  source: "metadata",
  itemId: 1,
  playerId: "player",
  gameTime: 10,
  status: "review",
  ...values,
});
const offline = (purchases, fields = {}) => ({
  mode: "offline",
  items: {
    revision: 4,
    purchases,
    fromStart: true,
    reviewCount: purchases.length,
    ...fields,
  },
});

test("existing metadata archives automatically expose recorded entries without altering stored evidence", () => {
  const session = offline([
    entry(1),
    entry(2, { status: "pending", flags: 1, soldTime: 30 }),
    entry(3, { status: "confirmed", evidence: "Operator confirmed" }),
    entry(4, { status: "refunded", evidence: "Operator verified full refund" }),
  ]);
  const original = structuredClone(session);
  const items = automaticItemHistory(session);
  assert.deepEqual(
    items.purchases.map((p) => p.status),
    ["recorded", "recorded", "confirmed", "refunded"],
  );
  assert.equal(items.purchases[1].flags, 1);
  assert.equal(items.purchases[1].soldTime, 30);
  assert.equal(items.purchases[3].evidence, "Operator verified full refund");
  assert.equal(items.reviewCount, 0);
  assert.equal(items.fromStart, true);
  assert.equal(items.revision, 4);
  assert.equal(items.reportBasis, "recorded-item-picks");
  assert.match(items.coverage, /refunds are not identified/);
  assert.deepEqual(session, original);
});

test("automatic reporting excludes non-purchases and corrupted upgrades, without interpreting opaque flags as refunds", () => {
  const items = automaticItemHistory(
    offline([
      entry(1, { gameTime: 0 }),
      entry(2, { gameTime: -5 }),
      entry(3, { gameTime: null }),
      entry(4, { upgradeInfo: 8388608 }),
      entry(5, { upgradeInfo: 131072, flags: 1, soldTime: 50 }),
      entry(6, { flags: 255, soldTime: 11 }),
    ]),
  );
  assert.deepEqual(
    items.purchases.map((p) => p.id),
    ["metadata:123:player:5", "metadata:123:player:6"],
  );
  assert.ok(items.purchases.every((p) => p.status === "recorded"));
});

test("automatic projections preserve partial history and do not change live refund review", () => {
  const session = offline([entry(1)], { fromStart: false });
  assert.equal(automaticItemHistory(session).fromStart, false);
  session.mode = "live";
  assert.strictEqual(automaticItemHistory(session), session.items);
  assert.equal(session.items.purchases[0].status, "review");
});

test("reported picks and confirmed live purchases retain purchase-occurrence units across cohorts", () => {
  const recorded = automaticItemHistory(
    offline([entry(1), entry(2), entry(3, { status: "refunded" })]),
  );
  const live = {
    purchases: [
      { itemId: 1, status: "confirmed" },
      { itemId: 1, status: "review" },
      { itemId: 1, status: "recorded", source: "live" },
    ],
  };
  const [row] = itemPriority(
    [recorded, live],
    [{ id: 1, name: "Item" }],
    [recorded],
  );
  assert.equal(row.total, 3);
  assert.equal(row.average, 1.5);
  assert.equal(row.averageChange, -0.5);
  assert.equal(row.rankChange, 0);
});

test("metadata in either comparison cohort changes the report label and discloses mixed refund coverage", () => {
  const recorded = automaticItemHistory(offline([entry(1)]));
  const live = { purchases: [{ itemId: 1, status: "confirmed" }] };
  assert.equal(itemReportDetails([live]).reportBasis, "verified-purchases");
  assert.equal(itemReportDetails([live]).metricLabel, "Confirmed purchases");
  const report = itemReportDetails([live], [recorded]);
  assert.equal(report.reportBasis, "recorded-item-picks");
  assert.equal(report.metricLabel, "Recorded item picks");
  assert.match(report.coverage, /full refunds are not identified/);
  assert.match(report.coverage, /Live recordings count confirmed purchases/);
  assert.doesNotMatch(
    itemReportDetails([recorded]).coverage,
    /Live recordings/,
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import { draftPriority } from "../src/analytics.js";

test("metadata selections without draft order contribute only to unknown-round categories", () => {
  const rows = draftPriority(
    [
      {
        selections: [
          {
            heroId: 1,
            selectionType: "pick",
            orderKnown: false,
            firstRound: null,
          },
          {
            heroId: 2,
            selectionType: "ban",
            orderKnown: false,
            firstRound: null,
          },
          { heroId: 1, selectionType: "ban", firstRound: null },
        ],
      },
    ],
    [
      { id: 1, name: "One" },
      { id: 2, name: "Two" },
    ],
  );
  const one = rows.find((row) => row.id === 1),
    two = rows.find((row) => row.id === 2);
  assert.equal(one.total, 2);
  assert.equal(one.unknownPick, 1);
  assert.equal(one.unknownBan, 1);
  assert.equal(one.firstPick + one.pick + one.firstBan + one.ban, 0);
  assert.equal(two.total, 1);
  assert.equal(two.unknownBan, 1);
  assert.equal(two.ban, 0);
});

test("verified and legacy known rounds keep their categories in mixed tournament reports", () => {
  const [row] = draftPriority([
    {
      selections: [
        {
          heroId: 8,
          selectionType: "pick",
          orderKnown: true,
          firstRound: true,
        },
        { heroId: 8, selectionType: "pick", firstRound: false },
        { heroId: 8, selectionType: "ban", firstRound: true },
        { heroId: 8, selectionType: "ban", firstRound: false },
        {
          heroId: 8,
          selectionType: "pick",
          orderKnown: false,
          firstRound: true,
        },
        {
          heroId: 8,
          selectionType: "ban",
          orderKnown: false,
          firstRound: false,
        },
      ],
    },
  ]);
  assert.equal(row.total, 6);
  for (const category of [
    "firstPick",
    "pick",
    "firstBan",
    "ban",
    "unknownPick",
    "unknownBan",
  ])
    assert.equal(row[category], 1);
});

test("unknown categories initialize for unselected heroes and invalid selections do not inflate totals", () => {
  const [row] = draftPriority(
    [
      {
        selections: [
          { heroId: 1, selectionType: "unknown", orderKnown: false },
          { heroId: null, selectionType: "pick", orderKnown: false },
        ],
      },
    ],
    [{ id: 1, name: "One" }],
  );
  assert.equal(row.total, 0);
  assert.equal(row.unknownPick, 0);
  assert.equal(row.unknownBan, 0);
});

import test from "node:test";
import assert from "node:assert/strict";
import { draftPriority } from "../src/analytics.js";

test("genuine draft selections without known order count as ordinary picks and bans", () => {
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
  assert.equal(one.unknownPick, 0);
  assert.equal(one.unknownBan, 0);
  assert.equal(one.pick, 1);
  assert.equal(one.ban, 1);
  assert.equal(one.firstPick + one.firstBan, 0);
  assert.equal(two.total, 1);
  assert.equal(two.unknownBan, 0);
  assert.equal(two.ban, 1);
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
  assert.equal(row.firstPick, 1);
  assert.equal(row.firstBan, 1);
  assert.equal(row.pick, 2);
  assert.equal(row.ban, 2);
  assert.equal(row.unknownPick + row.unknownBan, 0);
});

test("metadata rosters never count as draft selections even if their order is forged", () => {
  const selections = [
    { heroId: 1, selectionType: "pick", orderKnown: true, firstRound: true },
  ];
  const records = [
    { source: "metadata", selections },
    { rule: "metadata-final-roster", source: "manual", selections },
    { id: "metadata:tournament:123", source: "live", selections },
    { source: "live", selections },
  ];
  const [row] = draftPriority(records, [{ id: 1, name: "One" }]);
  assert.equal(row.total, 1);
  assert.equal(row.firstPick, 1);
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

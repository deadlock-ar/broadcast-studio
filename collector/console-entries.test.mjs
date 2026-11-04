import test from "node:test";
import assert from "node:assert/strict";
import {
  appendConsoleEntry,
  CONSOLE_ENTRY_LIMIT,
  CONSOLE_COMMAND_LIMIT,
} from "./console-entries.mjs";

test("Valve console packets retain command text and source tick without inventing player attribution", () => {
  const entries = [];
  assert.equal(
    appendConsoleEntry(entries, {
      type: { id: 9 },
      tick: 215,
      data: { cmdstring: "sv_cheats 0", playerId: "untrusted" },
    }),
    true,
  );
  assert.deepEqual(entries, [
    {
      tick: 215,
      command: "sv_cheats 0",
      truncated: false,
      playerId: null,
      source: "demo-console-command",
    },
  ]);
});

test("unrelated and malformed packets do not become purported command evidence", () => {
  const entries = [];
  for (const packet of [
    null,
    { type: { id: 7 }, data: { cmdstring: "noclip" } },
    { type: { id: 9 }, data: { cmdstring: "   " } },
    { type: { id: 9 }, data: { unknown: "noclip" } },
    { type: { id: 9 }, data: { cmdstring: { command: "noclip" } } },
  ])
    assert.equal(appendConsoleEntry(entries, packet), false);
  assert.deepEqual(entries, []);
});

test("console retention is bounded and marks shortened text explicitly", () => {
  const entries = [];
  for (let tick = 0; tick <= CONSOLE_ENTRY_LIMIT; tick++)
    appendConsoleEntry(entries, {
      type: { id: 9 },
      tick,
      data: { cmdstring: String(tick) },
    });
  assert.equal(entries.length, CONSOLE_ENTRY_LIMIT);
  assert.equal(entries[0].tick, 1);
  appendConsoleEntry(entries, {
    type: { id: 9 },
    tick: 900,
    data: { cmdstring: "x".repeat(CONSOLE_COMMAND_LIMIT + 10) },
  });
  assert.equal(entries.length, CONSOLE_ENTRY_LIMIT);
  assert.equal(entries.at(-1).command.length, CONSOLE_COMMAND_LIMIT);
  assert.equal(entries.at(-1).truncated, true);
});

test("legacy parser text aliases remain readable without serializing unknown data", () => {
  const entries = [];
  for (const data of [{ command: "echo legacy" }, { cmd: "echo older" }])
    appendConsoleEntry(entries, { type: { id: 9 }, data });
  assert.deepEqual(
    entries.map((entry) => entry.command),
    ["echo legacy", "echo older"],
  );
  assert.equal(entries[0].tick, null);
});

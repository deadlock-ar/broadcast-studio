import test from "node:test";
import assert from "node:assert/strict";
import {
  initialWorkspace,
  patchWorkspace,
  diffFields,
} from "../src/workspace-model.js";
import { cleanReportSettings } from "../src/analytics.js";
test("report selections and titles merge across admins without overwriting one another", () => {
  const first = initialWorkspace(),
    next = patchWorkspace(
      first,
      diffFields("", "Cup hero priority", ["reports", "titles", "heroes"]),
    );
  const shared = patchWorkspace(
    next,
    diffFields([], ["statlocker:ABCDEFGH"], ["reports", "selectedDrafts"]),
  );
  assert.equal(shared.reports.titles.heroes, "Cup hero priority");
  assert.deepEqual(shared.reports.selectedDrafts, ["statlocker:ABCDEFGH"]);
  assert.throws(
    () =>
      patchWorkspace(
        shared,
        diffFields("", "Stale title", ["reports", "titles", "heroes"]),
      ),
    (e) => e.status === 409,
  );
});
test("report settings bound archive selections and do not admit arbitrary fields", () => {
  const clean = cleanReportSettings({
    selectedGames: ["123", "123", null],
    titles: { heroes: "x".repeat(100) },
    mode: "unknown",
    password: "private",
  });
  assert.deepEqual(clean.selectedGames, ["123"]);
  assert.equal(clean.titles.heroes.length, 43);
  assert.equal(clean.mode, "heroes");
  assert.equal(clean.password, undefined);
});

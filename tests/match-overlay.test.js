import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanMatchOverlay,
  resolveMatchOverlay,
  matchOverlayWins,
} from "../src/match-overlay.js";

function workspace() {
  return {
    config: {
      event: "Shared tournament",
      format: "BO3",
      useSourceNames: false,
      teams: [
        { name: "Left club", score: 1 },
        { name: "Right club", score: 0 },
      ],
    },
    draft: {
      snapshot: {
        teams: [{ teamNumber: 1, displayName: "Draft left" }],
        steps: [
          { teamNumber: 1, selectionType: "ban", heroId: 6 },
          { teamNumber: 2, selectionType: "ban", heroId: 13 },
          { teamNumber: 1, selectionType: "pick", heroId: 3 },
          { teamNumber: 1, selectionType: "ban", heroId: null },
          { teamNumber: 1, selectionType: "ban", heroId: 27 },
        ],
      },
    },
    matchOverlay: cleanMatchOverlay(),
  };
}

test("linked overlay follows the displayed names, score, event and original draft ban slots", () => {
  const source = workspace();
  let result = resolveMatchOverlay(source);
  assert.deepEqual(result.teams[0].bans, [6, null, 27]);
  assert.deepEqual(result.teams[1].bans, [13, null, null]);
  assert.equal(result.teams[0].name, "Left club");
  assert.deepEqual(result.teams[0].scoreBoxes, [true, false, false, false]);
  assert.equal(result.tournament.name, "Shared tournament");
  source.config.useSourceNames = true;
  result = resolveMatchOverlay(source);
  assert.equal(result.teams[0].name, "Draft left");
  assert.equal(result.teams[1].name, "Right club");
  source.draft.snapshot.steps = [];
  assert.deepEqual(resolveMatchOverlay(source).teams[0].bans, [
    null,
    null,
    null,
  ]);
});

test("manual override fields remain independent of the draft and shared branding", () => {
  const source = workspace();
  source.matchOverlay.links = {
    names: false,
    bans: false,
    scores: false,
    event: false,
  };
  source.matchOverlay.teams[0] = {
    name: "Manual club",
    accent: "#aabbcc",
    bans: [1, 2, 3],
    scoreBoxes: [false, true, false, false],
  };
  source.matchOverlay.tournament.name = "Manual tournament";
  const before = structuredClone(source);
  const result = resolveMatchOverlay(source);
  assert.equal(result.teams[0].name, "Manual club");
  assert.deepEqual(result.teams[0].bans, [1, 2, 3]);
  assert.deepEqual(result.teams[0].scoreBoxes, [false, true, false, false]);
  assert.equal(result.tournament.name, "Manual tournament");
  assert.deepEqual(source, before);
});

test("BO1/BO3 overrides switch win-box counts without modifying the source format", () => {
  const source = workspace();
  source.matchOverlay.format = "BO1";
  assert.equal(matchOverlayWins(resolveMatchOverlay(source).format), 1);
  source.matchOverlay.format = "BO3";
  assert.equal(matchOverlayWins(resolveMatchOverlay(source).format), 2);
  assert.equal(source.config.format, "BO3");
  source.matchOverlay.format = "linked";
  source.config.format = "BO5";
  assert.equal(matchOverlayWins(resolveMatchOverlay(source).format), 3);
});

test("overlay settings constrain fonts, hero IDs and images, and keep the logo empty by default", () => {
  const value = cleanMatchOverlay({
    font: "untrusted-font",
    format: "BO99",
    hudHeight: 999,
    center: { logo: "javascript:alert(1)" },
    teams: [{ bans: [6, 99999, "13"], accent: "red; background:url(example)" }],
  });
  assert.equal(value.font, "bodoni");
  assert.equal(value.format, "linked");
  assert.equal(value.hudHeight, 35);
  assert.equal(value.center.logo, null);
  assert.deepEqual(value.teams[0].bans, [6, null, 13]);
  assert.equal(value.teams[0].accent, "#e49d21");
});

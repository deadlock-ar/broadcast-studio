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

test("name labels follow the live HUD order while manual edits follow player identity", () => {
  const source = workspace();
  source.deadem = { id: "123" };
  source.matchOverlay.playerNames.enabled = true;
  source.matchOverlay.playerNames.overrides = { 1: "Broadcast one" };
  const session = {
    id: "123",
    settings: { names: { 2: "Desk two" }, hudOrder: ["1", "2", "3"] },
    match: {
      players: [
        { id: "1", team: 0, slot: 0, name: "Game one", heroId: 1 },
        { id: "2", team: 0, slot: 1, name: "Game two", heroId: 2 },
        { id: "3", team: 1, slot: 2, name: "Game three", heroId: 3 },
      ],
    },
  };
  let result = resolveMatchOverlay(source, session).playerNames;
  assert.equal(result.source, "live");
  assert.equal(result.teams[0][0].name, "Broadcast one");
  assert.equal(result.teams[0][0].sourceName, "Game one");
  assert.equal(result.teams[0][0].manual, true);
  assert.equal(result.teams[0][1].name, "Desk two");
  session.settings.hudOrder = ["2", "1", "3"];
  result = resolveMatchOverlay(source, session).playerNames;
  assert.deepEqual(
    result.teams[0].slice(0, 2).map((p) => p.id),
    ["2", "1"],
  );
  assert.equal(result.teams[0][0].name, "Desk two");
  assert.equal(result.teams[0][1].name, "Broadcast one");
  delete source.matchOverlay.playerNames.overrides["1"];
  assert.equal(
    resolveMatchOverlay(source, session).playerNames.teams[0][1].name,
    "Game one",
  );
  assert.equal(session.match.players[0].name, "Game one");
  assert.deepEqual(session.settings.names, { 2: "Desk two" });
});

test("selected games and cleared feeds cannot retain a different match's player labels", () => {
  const source = workspace();
  source.activeTournamentId = "cup-one";
  source.deadem = { id: "new-game" };
  source.apiStats = {
    result: {
      match: {
        players: [
          { id: "8", team: 0, slot: 0, name: "Old API name", heroId: 1 },
        ],
      },
    },
    panel: { names: {} },
  };
  const stale = {
    id: "old-game",
    tournamentId: "cup-one",
    match: {
      players: [
        { id: "7", team: 0, slot: 0, name: "Old collector name", heroId: 1 },
      ],
    },
  };
  let result = resolveMatchOverlay(source, stale).playerNames;
  assert.equal(result.source, "manual");
  assert.equal(result.teams[0][0].name, "");
  assert.equal(result.teams[0][0].id, "manual-0-0");
  stale.id = "new-game";
  stale.tournamentId = "other-cup";
  assert.equal(
    resolveMatchOverlay(source, stale).playerNames.teams[0][0].name,
    "",
  );
  source.deadem.id = "";
  result = resolveMatchOverlay(source, stale).playerNames;
  assert.equal(result.source, "api");
  assert.equal(result.teams[0][0].name, "Old API name");
  source.apiStats.result.match = null;
  result = resolveMatchOverlay(source, stale).playerNames;
  assert.equal(result.source, "manual");
  assert.equal(result.teams[0][0].name, "");
  assert.equal(result.teams[0].length, 6);
  assert.equal(result.teams[1].length, 6);
});

test("API names use existing display edits and empty roster slots use only their own manual text", () => {
  const source = workspace();
  source.apiStats = {
    result: {
      match: {
        players: [{ id: "9", team: 1, slot: 0, name: "Game nine", heroId: 3 }],
      },
    },
    panel: { names: { 9: "API display nine" } },
  };
  source.matchOverlay.playerNames.manual[0][0] = "Manual first";
  source.matchOverlay.playerNames.manual[1][1] = "Manual reserve";
  let result = resolveMatchOverlay(source).playerNames;
  assert.equal(result.teams[1][0].name, "API display nine");
  assert.equal(result.teams[1][0].sourceName, "API display nine");
  assert.equal(result.teams[1][0].manual, false);
  assert.equal(result.teams[0][0].name, "Manual first");
  assert.equal(result.teams[1][1].name, "Manual reserve");
  source.apiStats.result.match.players = [];
  result = resolveMatchOverlay(source).playerNames;
  assert.equal(result.teams[1][0].name, "");
  assert.equal(result.teams[1][0].heroId, null);
});

test("transparency and label settings sanitize bounds, identities and old defaults", () => {
  const defaults = cleanMatchOverlay();
  assert.equal(defaults.backgroundOpacity, 100);
  assert.equal(defaults.playerNames.enabled, false);
  assert.deepEqual(defaults.playerNames.layout, {
    x: 326,
    y: 64,
    width: 94,
    height: 22,
    gap: 5,
    teamGap: 143,
    fontSize: 14,
  });
  const result = cleanMatchOverlay({
    backgroundOpacity: -18,
    playerNames: {
      enabled: true,
      overrides: {
        1: "  Broadcast  ",
        2: " ",
        unsafe: "Skip",
        3: "a".repeat(80),
      },
      manual: [["a".repeat(70)], ["Right"]],
      layout: {
        x: Infinity,
        y: -6,
        width: 1000,
        height: 1,
        gap: -4,
        teamGap: NaN,
        fontSize: 200,
      },
    },
  });
  assert.equal(result.backgroundOpacity, 0);
  assert.equal(
    cleanMatchOverlay({ backgroundOpacity: 101 }).backgroundOpacity,
    100,
  );
  assert.equal(
    cleanMatchOverlay({ backgroundOpacity: 85.6 }).backgroundOpacity,
    86,
  );
  assert.equal(
    cleanMatchOverlay({ backgroundOpacity: NaN }).backgroundOpacity,
    100,
  );
  assert.deepEqual(result.playerNames.overrides, {
    1: "  Broadcast  ",
    3: "a".repeat(48),
  });
  assert.equal(
    cleanMatchOverlay({ playerNames: { overrides: { 1: "First " } } })
      .playerNames.overrides["1"],
    "First ",
  );
  assert.equal(result.playerNames.manual[0][0].length, 48);
  assert.equal(result.playerNames.manual[0].length, 6);
  assert.equal(result.playerNames.layout.x, 326);
  assert.equal(result.playerNames.layout.y, 0);
  assert.equal(result.playerNames.layout.width, 250);
  assert.equal(result.playerNames.layout.height, 12);
  assert.equal(result.playerNames.layout.teamGap, 143);
  assert.equal(result.playerNames.layout.fontSize, 30);
  const bottom = cleanMatchOverlay({
    playerNames: { layout: { y: 1080, height: 70 } },
  }).playerNames.layout;
  assert.equal(bottom.y + bottom.height, 1080);
  const tooMany = Object.fromEntries(
    Array.from({ length: 300 }, (_, i) => [String(i + 1), "Player"]),
  );
  assert.equal(
    Object.keys(
      cleanMatchOverlay({ playerNames: { overrides: tooMany } }).playerNames
        .overrides,
    ).length,
    256,
  );
  assert.equal(
    cleanMatchOverlay({ playerNames: { overrides: tooMany } }).playerNames
      .overrides["25"],
    "Player",
  );
});

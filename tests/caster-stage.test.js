import test from "node:test";
import assert from "node:assert/strict";
import { generateBracket, setBracketResult } from "../src/bracket.js";
import { DEFAULT_TEAM_ICON } from "../src/team-identity.js";
import {
  cleanCasterStage,
  casterStageOutput,
  casterSlots,
  discordVoiceUrl,
} from "../src/caster-stage.js";

test("Discord sources are restricted to official Streamkit Voice URLs", () => {
  assert.equal(
    discordVoiceUrl(
      "https://streamkit.discord.com/overlay/voice?guild_id=123&channel_id=456",
    ),
    "https://streamkit.discord.com/overlay/voice?guild_id=123&channel_id=456",
  );
  assert.ok(
    discordVoiceUrl(
      "https://streamkit.discord.com/overlay/voice/123456789012345678/234567890123456789",
    ),
  );
  for (const url of [
    "http://streamkit.discord.com/overlay/voice",
    "https://streamkit.discord.com.evil.test/overlay/voice",
    "https://user:pass@streamkit.discord.com/overlay/voice",
    "https://discord.com/invite/test",
    "https://streamkit.discord.com/overlay/chat",
    "javascript:alert(1)",
    "https://streamkit.discord.com:8080/overlay/voice",
  ])
    assert.equal(discordVoiceUrl(url), "");
});

test("caster settings have bounded safe defaults without shared speaking states", () => {
  const value = cleanCasterStage({
    casterCount: 12,
    title: "x".repeat(100),
    layout: "iframe",
    casters: [
      {
        name: "  Analyst  ",
        avatar: "javascript:alert(1)",
        speaking: true,
        discordToken: "secret",
      },
    ],
  });
  assert.equal(value.casterCount, 2);
  assert.equal(value.title.length, 80);
  assert.equal(value.layout, "avatars");
  assert.equal(value.casters.length, 4);
  assert.deepEqual(value.casters[0], { name: "Analyst", role: "", avatar: "" });
  assert.equal(cleanCasterStage(null).visible, true);
});

test("broadcast upcoming match follows current branding and strips admin Discord source", () => {
  const workspace = {
    config: {
      event: "كأس المجتمع",
      round: "Final",
      format: "BO3",
      teams: [
        { name: "البرتقالي", score: 1, steamId: "secret" },
        { name: "Blue", score: 2, logo: "https://teams.test/blue.png" },
      ],
    },
    casterStage: {
      discordUrl:
        "https://streamkit.discord.com/overlay/voice?guild_id=123&channel_id=456",
      casters: [
        {
          name: "Caster One",
          avatar: "https://cdn.discordapp.com/avatars/user/image.png",
        },
      ],
      visible: false,
    },
  };
  const output = casterStageOutput(workspace);
  assert.equal(output.event, "كأس المجتمع");
  assert.equal(output.teams[0].name, "البرتقالي");
  assert.equal(output.teams[0].logo, DEFAULT_TEAM_ICON);
  assert.equal(output.teams[1].logo, "https://teams.test/blue.png");
  assert.deepEqual(
    output.teams.map((team) => team.score),
    [1, 2],
  );
  assert.equal(output.visible, false);
  assert.equal(output.round, "Final");
  assert.equal(output.casters.length, 2);
  assert.ok(!JSON.stringify(output).includes("guild_id"));
  assert.ok(!JSON.stringify(output).includes("steamId"));
  workspace.config.teams.reverse();
  assert.equal(casterStageOutput(workspace).teams[0].name, "Blue");
  assert.deepEqual(
    casterStageOutput(workspace).teams.map((team) => team.score),
    [2, 1],
  );
});

test("broadcast source names and logos follow the same selection as the draft", () => {
  const workspace = {
    config: {
      useSourceNames: true,
      teams: [
        { name: "Configured orange", score: 1 },
        {
          name: "Configured blue",
          score: 0,
          logo: "https://teams.test/custom.png",
        },
      ],
    },
    draft: {
      snapshot: {
        teams: [
          {
            teamNumber: 2,
            displayName: "Source blue",
            teamLogo: "https://teams.test/source-blue.png",
          },
          {
            teamNumber: 1,
            displayName: "Source orange",
            teamLogo: "https://teams.test/source-orange.png",
          },
        ],
      },
    },
  };
  let output = casterStageOutput(workspace);
  assert.deepEqual(
    output.teams.map((team) => team.name),
    ["Source orange", "Source blue"],
  );
  assert.equal(output.teams[0].logo, "https://teams.test/source-orange.png");
  assert.equal(output.teams[1].logo, "https://teams.test/custom.png");
  assert.deepEqual(
    output.teams.map((team) => team.score),
    [1, 0],
  );
  workspace.config.useSourceNames = false;
  output = casterStageOutput(workspace);
  assert.equal(output.teams[0].name, "Configured orange");
  assert.equal(output.teams[0].logo, DEFAULT_TEAM_ICON);
});

test("manual match stays independent and a missing bracket selection clears stale names", () => {
  const casterStage = {
    source: "manual",
    teams: [
      { name: "Orange", score: 2, logo: "https://teams.test/orange.png" },
      { name: "Blue", score: 1 },
    ],
  };
  assert.deepEqual(
    casterStageOutput({ casterStage }).teams.map((team) => team.name),
    ["Orange", "Blue"],
  );
  const manual = casterStageOutput({
    casterStage,
    config: { teams: [{ score: 8 }, { score: 9 }] },
  });
  assert.deepEqual(
    manual.teams.map((team) => team.score),
    [2, 1],
  );
  assert.deepEqual(
    manual.teams.map((team) => team.logo),
    ["https://teams.test/orange.png", DEFAULT_TEAM_ICON],
  );
  casterStage.source = "bracket";
  casterStage.matchId = "missing";
  assert.deepEqual(
    casterStageOutput({ casterStage }).teams.map((team) => team.name),
    ["To be decided", "To be decided"],
  );
  assert.deepEqual(
    casterStageOutput({ casterStage }).teams.map((team) => ({
      logo: team.logo,
      score: team.score,
      resolved: team.resolved,
    })),
    [
      { logo: "", score: null, resolved: false },
      { logo: "", score: null, resolved: false },
    ],
  );
});

test("manual series scores are bounded while missing teams remain unassigned", () => {
  const stage = cleanCasterStage({
    source: "manual",
    teams: [
      { name: "Orange", score: 1000 },
      { score: -8, logo: "javascript:bad" },
    ],
  });
  assert.equal(stage.teams[0].score, 99);
  assert.equal(stage.teams[1].score, 0);
  assert.equal(stage.teams[1].logo, "");
  const output = casterStageOutput({ casterStage: stage });
  assert.equal(output.teams[0].score, 99);
  assert.equal(output.teams[1].score, null);
  assert.equal(output.teams[1].logo, "");
});

test("bracket match promotion resolves entrants and excludes private roster identities", () => {
  let bracket = generateBracket(
    [
      {
        id: "orange",
        name: "Orange",
        logo: "https://teams.test/orange.png",
        players: [{ steamId: "76561198000000000", name: "Private roster" }],
      },
      { id: "blue", name: "Blue" },
    ],
    { seeding: "manual", format: "BO3" },
  );
  bracket = setBracketResult(bracket, "r1-m1", { scores: [1, 0] });
  const output = casterStageOutput({
    bracket,
    config: { teams: [{ score: 9 }, { score: 8 }] },
    casterStage: { source: "bracket", matchId: "r1-m1" },
  });
  assert.deepEqual(
    output.teams.map((team) => team.name),
    ["Orange", "Blue"],
  );
  assert.equal(output.format, "BO3");
  assert.deepEqual(
    output.teams.map((team) => team.score),
    [1, 0],
  );
  assert.deepEqual(
    output.teams.map((team) => team.logo),
    ["https://teams.test/orange.png", DEFAULT_TEAM_ICON],
  );
  assert.ok(!JSON.stringify(output).includes("Private roster"));
  assert.ok(!JSON.stringify(output).includes("76561198000000000"));
});

test("an unresolved bracket fixture does not display another match's scores", () => {
  const bracket = generateBracket(
    [
      { id: "a", name: "A" },
      { id: "b", name: "B" },
      { id: "c", name: "C" },
      { id: "d", name: "D" },
    ],
    { seeding: "manual", format: "BO3" },
  );
  const output = casterStageOutput({
    bracket,
    config: {
      teams: [
        { name: "Other A", score: 2 },
        { name: "Other B", score: 1 },
      ],
    },
    casterStage: { source: "bracket", matchId: "r2-m1" },
  });
  assert.deepEqual(
    output.teams.map((team) => team.name),
    ["To be decided", "To be decided"],
  );
  assert.deepEqual(
    output.teams.map((team) => team.score),
    [null, null],
  );
  assert.deepEqual(
    output.teams.map((team) => team.logo),
    ["", ""],
  );
});

test("camera slots stay centered within the 1920 canvas without overlapping matchup", () => {
  for (const count of [1, 2, 3, 4]) {
    const slots = casterSlots(count);
    assert.equal(slots.length, count);
    assert.ok(slots[0].x > 0);
    assert.ok(
      Math.abs(slots[0].x - (1920 - slots.at(-1).x - slots.at(-1).width)) <
        0.001,
    );
    for (const slot of slots) assert.ok(slot.y + slot.height < 808);
    for (let index = 1; index < slots.length; index++)
      assert.ok(slots[index].x > slots[index - 1].x + slots[index - 1].width);
  }
});

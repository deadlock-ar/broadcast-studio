import test from "node:test";
import assert from "node:assert/strict";
import { generateBracket } from "../src/bracket.js";
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
      teams: [{ name: "البرتقالي", steamId: "secret" }, { name: "Blue" }],
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
  assert.equal(output.visible, false);
  assert.equal(output.round, "Final");
  assert.equal(output.casters.length, 2);
  assert.ok(!JSON.stringify(output).includes("guild_id"));
  assert.ok(!JSON.stringify(output).includes("steamId"));
  workspace.config.teams.reverse();
  assert.equal(casterStageOutput(workspace).teams[0].name, "Blue");
});

test("manual match stays independent and a missing bracket selection clears stale names", () => {
  const casterStage = {
    source: "manual",
    teams: [{ name: "Orange" }, { name: "Blue" }],
  };
  assert.deepEqual(
    casterStageOutput({ casterStage }).teams.map((team) => team.name),
    ["Orange", "Blue"],
  );
  casterStage.source = "bracket";
  casterStage.matchId = "missing";
  assert.deepEqual(
    casterStageOutput({ casterStage }).teams.map((team) => team.name),
    ["To be decided", "To be decided"],
  );
});

test("bracket match promotion resolves entrants and excludes private roster identities", () => {
  const bracket = generateBracket(
    [
      {
        id: "orange",
        name: "Orange",
        players: [{ steamId: "76561198000000000", name: "Private roster" }],
      },
      { id: "blue", name: "Blue" },
    ],
    { seeding: "manual", format: "BO3" },
  );
  const output = casterStageOutput({
    bracket,
    casterStage: { source: "bracket", matchId: "r1-m1" },
  });
  assert.deepEqual(
    output.teams.map((team) => team.name),
    ["Orange", "Blue"],
  );
  assert.equal(output.format, "BO3");
  assert.ok(!JSON.stringify(output).includes("Private roster"));
  assert.ok(!JSON.stringify(output).includes("76561198000000000"));
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

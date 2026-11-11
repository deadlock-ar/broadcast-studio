import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanCasterStage,
  cleanDiscordUserId,
  casterStageOutput,
} from "../src/caster-stage.js";
import {
  casterIdsError,
  fixedCasterCss,
  FIXED_CASTER_SLOTS,
} from "../src/discord-caster-css.js";

const ids = [
  "100000000000000001",
  "100000000000000002",
  "100000000000000003",
  "100000000000000004",
];
test("caster account IDs retain exact snowflakes and are excluded from public output", () => {
  assert.equal(Number(ids[0]), Number(ids[1]));
  const settings = cleanCasterStage({
    layout: "discord",
    casters: ids.map((discordUserId, i) => ({
      name: `Caster ${i + 1}`,
      discordUserId,
    })),
  });
  assert.deepEqual(
    settings.casters.map((person) => person.discordUserId),
    ids,
  );
  const output = casterStageOutput({ casterStage: settings });
  for (const id of ids) assert.ok(!JSON.stringify(output).includes(id));
  assert.ok(
    output.casters.every((person) => !Object.hasOwn(person, "discordUserId")),
  );
  assert.equal(cleanDiscordUserId(` ${ids[0]} `), ids[0]);
  assert.equal(cleanDiscordUserId(Number(ids[0])), "");
  assert.equal(cleanDiscordUserId("18446744073709551616"), "");
  assert.equal(cleanCasterStage().casters[0].discordUserId, "");
});
test("missing, duplicate, malformed and injected IDs cannot generate a caster allowlist", () => {
  for (const values of [
    [],
    [ids[0]],
    [ids[0], ids[0]],
    [ids[0], '100000000000000002"]{}'],
    [ids[0], "not-an-id"],
    [ids[0], "99999999999999999999"],
  ]) {
    assert.ok(casterIdsError(2, values));
    assert.throws(() => fixedCasterCss(2, values));
  }
  assert.ok(casterIdsError(8, ids));
});
test("every supported count produces ID-only slot rules and a hidden default without order fallbacks", () => {
  for (const count of [1, 2, 3, 4]) {
    const css = fixedCasterCss(count, ids);
    assert.equal(casterIdsError(count, ids), "");
    assert.match(css, /\.voice_state\s*\{\s*display: none !important/);
    assert.ok(!css.includes("nth-child"));
    for (const [i, id] of ids.slice(0, count).entries()) {
      assert.ok(css.includes(`[data-userid="${id}"]`));
      const slot = FIXED_CASTER_SLOTS[count][i];
      assert.ok(slot.left >= 0 && slot.left + 216 < 1920);
      assert.equal(slot.top, 360);
    }
  }
});

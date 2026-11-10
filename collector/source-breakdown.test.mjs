import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  decodePostMatchSources,
  matchPostMatchSources,
} from "./source-breakdown.mjs";
import { soulsBySource } from "./source-totals.mjs";

const fixture = JSON.parse(
  await readFile(
    new URL("../tests/post-match-sources.fixture.json", import.meta.url),
  ),
);
const bytes = Buffer.from(fixture.base64, "base64");
const frame = () => structuredClone(fixture.expected);

test("actual post-match wire payload yields income sources for twelve players without replacing captured totals", () => {
  const decoded = decodePostMatchSources(bytes);
  const current = frame();
  current.players[0].souls = 1280588;
  const before = structuredClone(current);
  const result = matchPostMatchSources(decoded, current);
  assert.equal(result.matchId, "134405814");
  assert.equal(result.duration, 1831);
  assert.equal(result.source, "recording-post-match");
  assert.equal(result.players.length, 12);
  assert.ok(
    result.players.every(
      (p) => p.sampleTime === 1831 && p.soulsBySource.length === 13,
    ),
  );
  assert.equal(
    result.players[0].soulsBySource.find((s) => s.source === 1).gold,
    51296,
  );
  assert.equal(
    result.players[0].soulsBySource.find((s) => s.source === 2).gold,
    16673,
  );
  assert.deepEqual(current, before);
  assert.equal(result.players[0].souls, undefined);
});

test("explicit protobuf zero stays known while an absent optional orb amount remains a subtotal", () => {
  const decoded = decodePostMatchSources(bytes);
  const sources = decoded.players[0].soulsBySource;
  assert.deepEqual(
    sources.find((s) => s.source === 1),
    {
      source: 1,
      label: "Players",
      gold: 51296,
      knownGold: 51296,
      complete: true,
    },
  );
  assert.deepEqual(
    sources.find((s) => s.source === 5),
    {
      source: 5,
      label: "Treasure",
      gold: null,
      knownGold: 500,
      complete: false,
    },
  );
  assert.deepEqual(
    sources.find((s) => s.source === 8),
    {
      source: 8,
      label: "Team bonus",
      gold: null,
      knownGold: 0,
      complete: false,
    },
  );
  assert.equal(
    soulsBySource({ gold_sources: [{ source: 1, gold: 0, gold_orbs: 0 }] })[0]
      .complete,
    true,
  );
});

test("post-match details only attach to the same match, duration, exact roster and bot identities", () => {
  const decoded = decodePostMatchSources(bytes);
  for (const change of [
    (f) => {
      f.matchId = "134405815";
    },
    (f) => {
      f.duration = 1800;
    },
    (f) => {
      f.players[0].heroId++;
    },
    (f) => {
      f.players[0].team = 1;
    },
    (f) => {
      f.players[0].slot = 2;
    },
    (f) => {
      f.players[0].id = "123";
    },
    (f) => {
      f.players.pop();
    },
    (f) => {
      f.players[1].id = f.players[0].id;
    },
  ]) {
    const current = frame();
    change(current);
    assert.equal(matchPostMatchSources(decoded, current), null);
  }
});

test("malformed or incomplete post-match details cannot produce source totals", () => {
  for (const bad of [
    null,
    new Uint8Array(),
    new Uint8Array(1000001),
    bytes.subarray(0, 30),
    new Uint8Array([8, 1]),
  ])
    assert.throws(() => decodePostMatchSources(bad));
  assert.equal(soulsBySource({}), null);
});

import test from "node:test";
import assert from "node:assert/strict";
import { generateBracket } from "../src/bracket.js";
import {
  normalizeBannerSteamId,
  cleanPlayerBanners,
  resolveBannerTeams,
  playerBannersOutput,
} from "../src/player-banners.js";

const steam = (id) => String(76561197960265728n + BigInt(id));
const teams = [1, 2, 3].map((index) => ({
  id: `team-${index}`,
  name: `Team ${index}`,
  tag: `T${index}`,
  players: [
    { id: `player-${index}`, name: `Player ${index}`, steamId: steam(index) },
  ],
}));
const workspace = () => ({
  config: { event: "Community Cup", teams: teams.slice(0, 2) },
  bracket: generateBracket(teams, { seeding: "manual" }),
  playerBanners: cleanPlayerBanners(),
});

test("banner Steam identities normalize exactly and reject unrelated, vanity and unsafe inputs", () => {
  assert.equal(normalizeBannerSteamId("12345"), steam(12345));
  assert.equal(normalizeBannerSteamId(12345), steam(12345));
  assert.equal(
    normalizeBannerSteamId(
      `https://steamcommunity.com/profiles/${steam(12345)}/`,
    ),
    steam(12345),
  );
  assert.equal(normalizeBannerSteamId("4294967295"), steam(4294967295));
  for (const value of [
    0,
    -1,
    "0",
    "76561197960265728",
    "76561202255233024",
    Number(steam(1)),
    "https://steamcommunity.com/id/person",
    `https://steamcommunity.com.evil.test/profiles/${steam(1)}`,
    `https://user@steamcommunity.com/profiles/${steam(1)}`,
    "javascript:alert(1)",
    {},
    null,
  ])
    assert.equal(normalizeBannerSteamId(value), "");
});

test("broadcast banners follow uniquely named entrants and keep the roster on the correct side after a swap", () => {
  const w = workspace();
  assert.deepEqual(
    resolveBannerTeams(w).map((team) => team.players[0].name),
    ["Player 1", "Player 2"],
  );
  w.bracket.activeMatchId = "r1-m1";
  w.config.teams.reverse();
  const output = resolveBannerTeams(w);
  assert.deepEqual(
    output.map((team) => team.name),
    ["Team 2", "Team 1"],
  );
  assert.deepEqual(
    output.map((team) => team.players[0].steamId),
    [steam(2), steam(1)],
  );
  assert.equal(output[0].players.length, 6);
});

test("stale or ambiguous branding never attaches an unrelated active match roster", () => {
  const w = workspace();
  w.bracket.activeMatchId = "r1-m1";
  w.config.teams[0] = { name: "Unrelated team" };
  assert.equal(resolveBannerTeams(w)[0].players[0].steamId, "");
  w.config.teams = [teams[0], teams[0]];
  assert.deepEqual(
    resolveBannerTeams(w).map((team) => team.players[0].steamId),
    ["", ""],
  );
});

test("selected bracket fixtures retain known entrants and leave unresolved opponents empty", () => {
  const w = workspace();
  w.playerBanners.source = "bracket";
  w.playerBanners.matchId = "r2-m1";
  const output = resolveBannerTeams(w);
  assert.equal(output[0].name, "To be decided");
  assert.equal(output[1].name, "Team 3");
  assert.equal(output[1].players[0].steamId, steam(3));
  w.playerBanners.matchId = "r1-m2";
  assert.deepEqual(
    resolveBannerTeams(w).map((team) => team.name),
    ["To be decided", "To be decided"],
  );
  w.playerBanners.matchId = "unknown";
  assert.deepEqual(
    resolveBannerTeams(w).map((team) => team.players[0].name),
    ["", ""],
  );
});

test("manual rosters and public projections use curated names, true top heroes and trusted rank assets", () => {
  const w = workspace();
  w.playerBanners = {
    source: "manual",
    teams: [teams[1], { name: "Custom", players: [{ steamId: "1" }] }],
    profiles: {
      [steam(2)]: {
        personaName: "Steam alias",
        status: "error",
        error: "Private diagnostic",
        updatedAt: 123456,
        fetchedAt: 123999,
        heroes: [
          { heroId: 1, matches: 3, wins: 2 },
          { heroId: 3, matches: 20, wins: 12 },
          { heroId: 2, matches: 10, wins: 5 },
          { heroId: 4, matches: 4, wins: 3 },
        ],
        rank: {
          tier: 11,
          subrank: 5,
          name: "False rank",
          image: "https://evil.test/tracker.png",
        },
      },
      [steam(1)]: { personaName: "Fallback alias", heroes: [] },
    },
  };
  const output = playerBannersOutput(w);
  const p = output.teams[0].players[0];
  assert.equal(p.name, "Player 2");
  assert.deepEqual(
    p.heroes.map((hero) => hero.heroId),
    [3, 2, 4],
  );
  assert.deepEqual(
    p.heroes.map((hero) => hero.winRate),
    [60, 50, 75],
  );
  assert.equal(p.status, "error");
  assert.equal(p.updatedAt, 123456);
  assert.equal(p.rank.name, "Eternus V");
  assert.equal(
    p.rank.image,
    "https://api.deadlock-api.com/v1/assets/ranks/11/5/image?format=webp",
  );
  assert.equal(output.teams[1].players[0].name, "Fallback alias");
  const json = JSON.stringify(output);
  for (const forbidden of [
    "steamId",
    steam(2),
    "Private diagnostic",
    "fetchedAt",
    "profiles",
    "player-2",
    "evil.test",
  ])
    assert.equal(json.includes(forbidden), false, forbidden);
  w.playerBanners.showRanks = false;
  assert.equal(playerBannersOutput(w).teams[0].players[0].rank, null);
});

test("banner cleaning bounds untrusted state and does not fabricate missing or unranked data", () => {
  const profiles = Object.fromEntries(
    Array.from({ length: 70 }, (_, i) => [
      steam(i + 1),
      {
        heroes: [
          { heroId: 1, matches: 4, wins: 99 },
          { heroId: 1, matches: 1, wins: 0 },
          { heroId: 2, matches: 0, wins: 0 },
          { heroId: -1, matches: 10, wins: 2 },
        ],
        rank: { tier: 0, subrank: 0 },
        updatedAt: Infinity,
      },
    ]),
  );
  Object.defineProperty(profiles, "__proto__", {
    value: { polluted: true },
    enumerable: true,
  });
  const state = cleanPlayerBanners({
    source: "wrong",
    visible: false,
    transparent: true,
    showRanks: false,
    teams: Array.from({ length: 4 }, () => ({
      name: "x".repeat(200),
      logo: "javascript:alert(1)",
      players: Array.from({ length: 9 }, () => ({
        name: "p".repeat(100),
        steamId: "1",
      })),
    })),
    profiles,
  });
  assert.equal(state.source, "broadcast");
  assert.equal(state.teams.length, 2);
  assert.equal(state.teams[0].players.length, 6);
  assert.equal(state.teams[0].name.length, 80);
  assert.equal(state.teams[0].players[0].name.length, 48);
  assert.equal(state.teams[0].logo, "");
  assert.equal(Object.keys(state.profiles).length, 64);
  assert.equal(
    Object.prototype.hasOwnProperty.call(state.profiles, "__proto__"),
    false,
  );
  assert.deepEqual(state.profiles[steam(70)].heroes, [
    { heroId: 1, matches: 4, wins: 4 },
  ]);
  assert.equal(state.profiles[steam(70)].rank, null);
  assert.equal(state.profiles[steam(70)].updatedAt, 0);
  const output = playerBannersOutput({
    playerBanners: { source: "manual", teams: [teams[0]] },
  });
  assert.equal(output.teams[0].players[0].status, "missing");
  assert.deepEqual(output.teams[0].players[0].heroes, []);
  assert.equal(output.teams[0].players[0].rank, null);
  assert.equal({}.polluted, undefined);
});

test("rank badges use official zero-padded tier artwork when no division is supplied", () => {
  const state = cleanPlayerBanners({
    profiles: {
      [steam(1)]: { rank: { tier: 1, subrank: 0 } },
      [steam(2)]: { rank: { tier: 9, subrank: 0 } },
      [steam(3)]: { rank: { tier: 11, subrank: 0 } },
    },
  });
  assert.equal(state.profiles[steam(1)].rank.name, "Initiate");
  assert.equal(
    state.profiles[steam(1)].rank.image,
    "https://assets-bucket.deadlock-api.com/assets-api-res/images/ranks/rank01_lg.webp",
  );
  assert.equal(
    state.profiles[steam(2)].rank.image,
    "https://assets-bucket.deadlock-api.com/assets-api-res/images/ranks/rank09_lg.webp",
  );
  assert.equal(
    state.profiles[steam(3)].rank.image,
    "https://assets-bucket.deadlock-api.com/assets-api-res/images/ranks/rank11_lg.webp",
  );
});

test("rank labels follow the current official catalog for middle tiers", () => {
  const state = cleanPlayerBanners({
    profiles: Object.fromEntries(
      [3, 4, 5, 6, 7].map((tier) => [
        steam(tier),
        {
          rank: { tier, subrank: 2 },
        },
      ]),
    ),
  });
  assert.deepEqual(
    [3, 4, 5, 6, 7].map((tier) => state.profiles[steam(tier)].rank.name),
    ["Acolyte II", "Sentinel II", "Mystic II", "Ritualist II", "Emissary II"],
  );
});

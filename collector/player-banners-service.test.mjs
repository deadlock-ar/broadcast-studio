import test from "node:test";
import assert from "node:assert/strict";
import {
  PlayerBannersService,
  seasonalBannerRanks,
} from "./player-banners-service.mjs";
import {
  cleanPlayerBanners,
  playerBannersOutput,
  bannerProfiles,
  bannerSeasonWindow,
} from "../src/player-banners.js";

const base = 76561197960265728n;
const steam = (id) => String(base + BigInt(id));
const response = (data, options = {}) =>
  new Response(JSON.stringify(data), {
    status: options.status || 200,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
function fixture({ count = 12, fetcher } = {}) {
  let time = 1800000000000;
  const calls = [];
  const workspace = {
    activeTournamentId: "cup-one",
    revision: 0,
    config: { event: "Banner Cup" },
    playerBanners: cleanPlayerBanners({
      source: "manual",
      teams: [0, 1].map((team) => ({
        id: `team-${team}`,
        name: `Team ${team}`,
        players: Array.from(
          { length: Math.min(6, Math.max(0, count - team * 6)) },
          (_, index) => {
            const id = team * 6 + index + 100;
            return {
              id: `player-${id}`,
              name: `Player ${id}`,
              steamId: steam(id),
            };
          },
        ),
      })),
    }),
  };
  const store = {
    workspace,
    saves: 0,
    saveWorkspace() {
      this.saves++;
    },
  };
  const fetch = async (url, options) => {
    calls.push({ url, options });
    if (fetcher) return fetcher(url, options);
    const route = new URL(url);
    const ids = route.searchParams.get("account_ids").split(",").map(Number);
    if (route.pathname.endsWith("hero-stats"))
      return response(
        ids.flatMap((account_id) => [
          { account_id, hero_id: 2, matches_played: 20, wins: 12 },
          { account_id, hero_id: 1, matches_played: 30, wins: 15 },
          { account_id, hero_id: 3, matches_played: 10, wins: 2 },
          { account_id, hero_id: 4, matches_played: 5, wins: 3 },
        ]),
      );
    if (route.pathname.endsWith("rank"))
      return response(
        ids.map((account_id) => ({
          account_id,
          badge: 115,
          rank: 11,
          subrank: 5,
          last_match: { match_id: 12 },
        })),
      );
    return response(
      ids.map((account_id) => ({
        account_id,
        personaname: `Steam ${account_id}`,
      })),
    );
  };
  const service = new PlayerBannersService(store, { fetch, now: () => time });
  return {
    store,
    service,
    calls,
    advance(ms) {
      time += ms;
    },
    now: () => time,
  };
}

test("refresh batches twelve canonical accounts into three fixed requests and publishes only display fields", async () => {
  const { store, service, calls, now } = fixture();
  assert.equal(await service.refresh(), store.workspace);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map(({ url }) => new URL(url).pathname).sort(), [
    "/v1/players/hero-stats",
    "/v1/players/rank",
    "/v1/players/steam",
  ]);
  for (const call of calls) {
    const url = new URL(call.url);
    assert.equal(url.origin, "https://api.deadlock-api.com");
    assert.equal(
      url.searchParams.get("account_ids"),
      Array.from({ length: 12 }, (_, i) => i + 100).join(","),
    );
    assert.ok(call.options.signal instanceof AbortSignal);
    assert.equal(call.options.headers.Accept, "application/json");
  }
  const profile = store.workspace.playerBanners.profiles[steam(100)];
  assert.equal(profile.updatedAt, now());
  assert.equal(profile.fetchedAt, now());
  assert.equal(profile.status, "ready");
  assert.deepEqual(
    profile.heroes.map((hero) => hero.heroId),
    [1, 2, 3],
  );
  assert.equal(profile.rank.name, "Eternus V");
  assert.equal(
    profile.rank.image,
    "https://api.deadlock-api.com/v1/assets/ranks/11/5/image?format=webp",
  );
  assert.equal(profile.personaName, "Steam 100");
  assert.equal(store.workspace.revision, 1);
  assert.equal(store.saves, 1);
  const output = playerBannersOutput(store.workspace);
  assert.equal(output.teams[0].players[0].name, "Player 100");
  assert.equal(output.teams[0].players[0].heroes[0].winRate, 50);
  assert.equal(JSON.stringify(output).includes(steam(100)), false);
  assert.equal(JSON.stringify(output).includes("account_id"), false);
});

test("fresh profiles use fifteen-minute cache and force refresh respects per-player attempt cooldown", async () => {
  const { service, store, calls, advance } = fixture({ count: 1 });
  await service.refresh();
  advance(30000);
  await service.refresh();
  assert.equal(calls.length, 3);
  await assert.rejects(
    service.refresh({ force: true }),
    (error) =>
      error.status === 429 &&
      error.retryAfter === 30 &&
      !error.message.includes(steam(100)),
  );
  advance(30000);
  await service.refresh({ force: true });
  assert.equal(calls.length, 6);
  advance(15 * 60 * 1000);
  await service.refresh();
  assert.equal(calls.length, 9);
  assert.equal(store.saves, 3);
});

test("partial endpoint failure retains prior rank while fresh heroes and persona names are saved", async () => {
  const f = fixture({ count: 1 });
  await f.service.refresh();
  const previous = structuredClone(
    f.store.workspace.playerBanners.profiles[steam(100)],
  );
  f.advance(61000);
  f.service.fetch = async (url) => {
    if (url.includes("hero-stats"))
      return response([
        { account_id: 100, hero_id: 6, matches_played: 50, wins: 35 },
      ]);
    if (url.includes("/rank")) throw Error("secret upstream body or URL");
    return response([{ account_id: 100, personaname: "New Steam name" }]);
  };
  await f.service.refresh({ force: true });
  const profile = f.store.workspace.playerBanners.profiles[steam(100)];
  assert.deepEqual(profile.rank, previous.rank);
  assert.equal(profile.heroes[0].heroId, 6);
  assert.equal(profile.personaName, "New Steam name");
  assert.equal(profile.updatedAt, f.now());
  assert.equal(profile.fetchedAt, f.now());
  assert.equal(profile.status, "error");
  assert.match(profile.error, /Rank information/);
  assert.equal(profile.error.includes("secret"), false);
  await assert.rejects(f.service.refresh({ force: true }), /just refreshed/);
  await assert.rejects(f.service.refresh(), /just refreshed/);
});

test("failed hero refresh preserves existing heroes and records an attempt without inventing zero stats", async () => {
  const f = fixture({ count: 1 });
  await f.service.refresh();
  const before = structuredClone(
    f.store.workspace.playerBanners.profiles[steam(100)],
  );
  f.advance(61000);
  f.service.fetch = async () =>
    response({ diagnostic: "untrusted details" }, { status: 500 });
  await f.service.refresh({ force: true });
  const after = f.store.workspace.playerBanners.profiles[steam(100)];
  assert.deepEqual(after.heroes, before.heroes);
  assert.deepEqual(after.rank, before.rank);
  assert.equal(after.updatedAt, before.updatedAt);
  assert.equal(after.fetchedAt, f.now());
  assert.equal(after.status, "error");
  assert.equal(after.error.includes("untrusted"), false);
});

test("ordinary retries after failures also honor the sixty-second attempt cooldown", async () => {
  const f = fixture({
    count: 1,
    fetcher: async () => response({}, { status: 500 }),
  });
  await f.service.refresh();
  assert.equal(f.calls.length, 3);
  f.advance(59000);
  await assert.rejects(
    f.service.refresh(),
    (error) => error.status === 429 && error.retryAfter === 1,
  );
  assert.equal(f.calls.length, 3);
  f.advance(1000);
  await f.service.refresh();
  assert.equal(f.calls.length, 6);
});

test("empty history and unranked response remain distinct from an unavailable protected rank", async () => {
  const f = fixture({
    count: 2,
    fetcher: async (url) => {
      if (url.includes("/rank"))
        return response([
          { account_id: 100, badge: 0, rank: 0, subrank: 0, last_match: null },
        ]);
      return response([]);
    },
  });
  await f.service.refresh();
  const first = f.store.workspace.playerBanners.profiles[steam(100)];
  const second = f.store.workspace.playerBanners.profiles[steam(101)];
  assert.equal(first.status, "empty");
  assert.equal(first.rank, null);
  assert.equal(first.error, "");
  assert.equal(second.status, "error");
  assert.equal(second.rank, null);
  assert.match(second.error, /unavailable for this player/);
});

test("rate-limit Retry-After applies a bounded global cooldown without leaking upstream body", async () => {
  const f = fixture({
    count: 1,
    fetcher: async () =>
      response(
        { token: "private" },
        {
          status: 429,
          headers: { "Retry-After": "9999999" },
        },
      ),
  });
  await f.service.refresh();
  const count = f.calls.length;
  f.advance(61000);
  await assert.rejects(
    f.service.refresh({ force: true }),
    (error) =>
      error.status === 429 &&
      error.retryAfter === 3539 &&
      !error.message.includes("private"),
  );
  assert.equal(f.calls.length, count);
  f.advance(3539000);
  await f.service.refresh({ force: true });
  assert.equal(f.calls.length, count + 3);
});

test("HTTP-date Retry-After on load shedding delays new requests", async () => {
  const f = fixture({ count: 1 });
  f.service.fetch = async () =>
    response([], {
      status: 503,
      headers: { "Retry-After": new Date(f.now() + 120000).toUTCString() },
    });
  await f.service.refresh();
  await assert.rejects(
    f.service.refresh(),
    (error) => error.retryAfter === 120,
  );
});

test("oversized and malformed responses keep the last safe data", async () => {
  const f = fixture({ count: 1 });
  await f.service.refresh();
  const old = f.store.workspace.playerBanners.profiles[steam(100)].heroes;
  f.advance(61000);
  f.service.fetch = async (url) =>
    url.includes("hero-stats")
      ? new Response(" ".repeat(2 * 1024 * 1024 + 1))
      : response({ unexpected: true });
  await f.service.refresh({ force: true });
  const profile = f.store.workspace.playerBanners.profiles[steam(100)];
  assert.deepEqual(profile.heroes, old);
  assert.equal(profile.status, "error");
  assert.equal(profile.error.includes("JSON"), false);
});

test("concurrent requests share one job and settings toggles during loading are preserved", async () => {
  const f = fixture({ count: 1 });
  const original = f.service.fetch;
  let release;
  const pause = new Promise((resolve) => {
    release = resolve;
  });
  f.service.fetch = async (...args) => {
    await pause;
    return original(...args);
  };
  const first = f.service.refresh();
  const second = f.service.refresh({ force: true });
  f.store.workspace.playerBanners.showRanks = false;
  f.store.workspace.playerBanners.visible = false;
  release();
  await Promise.all([first, second]);
  assert.equal(f.calls.length, 3);
  assert.equal(f.store.saves, 1);
  assert.equal(f.store.workspace.playerBanners.showRanks, false);
  assert.equal(f.store.workspace.playerBanners.visible, false);
});

test("tournament switches, including switching away and back, cannot commit stale requests", async () => {
  for (const returnToOriginal of [false, true]) {
    const f = fixture({ count: 1 });
    const original = f.service.fetch;
    let release;
    const pause = new Promise((resolve) => {
      release = resolve;
    });
    f.service.fetch = async (...args) => {
      await pause;
      return original(...args);
    };
    const pending = f.service.refresh();
    f.store.workspace.activeTournamentId = "cup-two";
    f.store.workspace.playerBanners = cleanPlayerBanners({ source: "manual" });
    if (returnToOriginal) f.store.workspace.activeTournamentId = "cup-one";
    release();
    await assert.rejects(pending, (error) => error.status === 409);
    assert.equal(f.store.saves, 0);
    assert.deepEqual(f.store.workspace.playerBanners.profiles, {});
  }
});

test("roster selection changes during loading cannot commit stale data", async () => {
  const f = fixture({ count: 1 });
  const original = f.service.fetch;
  let release;
  const pause = new Promise((resolve) => {
    release = resolve;
  });
  f.service.fetch = async (...args) => {
    await pause;
    return original(...args);
  };
  const pending = f.service.refresh();
  f.store.workspace.playerBanners.teams[0].players[0].steamId = steam(999);
  release();
  await assert.rejects(pending, /selection changed/);
  assert.equal(f.store.saves, 0);
});

test("missing accounts cause no upstream requests, duplicate accounts are batched once", async () => {
  const empty = fixture({ count: 0 });
  await assert.rejects(empty.service.refresh(), /Add Steam accounts/);
  assert.equal(empty.calls.length, 0);
  const f = fixture({ count: 2 });
  f.store.workspace.playerBanners.teams[0].players[1].steamId = steam(100);
  await f.service.refresh();
  assert.equal(f.calls.length, 3);
  for (const call of f.calls)
    assert.equal(new URL(call.url).searchParams.get("account_ids"), "100");
});

test("profile cache stays bounded and persistence failure rolls back workspace state", async () => {
  const f = fixture({ count: 1 });
  f.store.workspace.playerBanners.profiles = Object.fromEntries(
    Array.from({ length: 64 }, (_, index) => [
      steam(index + 1000),
      {
        heroes: [],
        status: "empty",
        updatedAt: 1,
        fetchedAt: 1,
      },
    ]),
  );
  await f.service.refresh();
  assert.equal(
    Object.keys(f.store.workspace.playerBanners.profiles).length,
    64,
  );
  assert.ok(f.store.workspace.playerBanners.profiles[steam(100)]);
  f.advance(61000);
  const previous = structuredClone(f.store.workspace);
  f.store.saveWorkspace = () => {
    throw Error("Persistence unavailable");
  };
  await assert.rejects(
    f.service.refresh({ force: true }),
    /Persistence unavailable/,
  );
  assert.deepEqual(f.store.workspace, previous);
});

const seasonDefinitions = () => [
  {
    class_name: "season_1",
    ranked_type: "normal",
    intervals: [
      { interval: 1, start_timestamp: 1785430800, end_timestamp: 1793908800 },
    ],
  },
  {
    class_name: "season_2",
    ranked_type: "normal",
    intervals: [
      { interval: 2, start_timestamp: 1793908800, end_timestamp: 1804802400 },
    ],
  },
];
function seasonFixture(options = {}) {
  const definitions = seasonDefinitions();
  const f = fixture({ count: 2 });
  f.store.workspace.playerBanners.statsScope = "season_1";
  f.service.fetch = async (url) => {
    f.calls.push({ url });
    const address = new URL(url);
    if (options.fetcher) {
      const result = await options.fetcher(address, definitions);
      if (result) return result;
    }
    if (address.pathname.endsWith("ranked-seasons"))
      return response(definitions);
    if (address.pathname.endsWith("match-history")) {
      const account_id = Number(address.pathname.split("/")[3]);
      return response([
        {
          account_id,
          match_id: 10,
          game_mode: 1,
          match_mode: 4,
          start_time: 1785430900,
          ranked_display_badge: 106,
        },
        {
          account_id,
          match_id: 11,
          game_mode: 1,
          match_mode: 4,
          start_time: 1785431000,
          ranked_display_badge: 94,
        },
        {
          account_id,
          match_id: 12,
          game_mode: 1,
          match_mode: 1,
          start_time: 1785431100,
          ranked_display_badge: 116,
        },
        {
          account_id,
          match_id: 13,
          game_mode: 4,
          match_mode: 4,
          start_time: 1785431200,
          ranked_display_badge: 116,
        },
        {
          account_id,
          match_id: 14,
          game_mode: 1,
          match_mode: 4,
          start_time: 1793908800,
          ranked_display_badge: 112,
        },
      ]);
    }
    const ids = address.searchParams.get("account_ids").split(",").map(Number);
    if (address.pathname.endsWith("hero-stats"))
      return response(
        ids.map((account_id) => ({
          account_id,
          hero_id: 2,
          matches_played: 8,
          wins: 5,
        })),
      );
    if (address.pathname.endsWith("steam"))
      return response(
        ids.map((account_id) => ({
          account_id,
          personaname: `Season Steam ${account_id}`,
        })),
      );
    throw Error("Season lookups must not request current rank");
  };
  return { ...f, definitions };
}

test("season hero queries are ranked/normal only with exact exclusive boundary and historical badges", async () => {
  const f = seasonFixture();
  await f.service.refresh();
  assert.equal(f.calls.length, 5);
  const query = new URL(
    f.calls.find(({ url }) => url.includes("hero-stats")).url,
  ).searchParams;
  assert.equal(query.get("match_mode"), "ranked");
  assert.equal(query.get("game_mode"), "normal");
  assert.equal(query.get("min_unix_timestamp"), "1785430800");
  assert.equal(query.get("max_unix_timestamp"), "1793908799");
  assert.equal(
    f.calls.some(({ url }) => new URL(url).pathname.endsWith("/rank")),
    false,
  );
  const profile = bannerProfiles(f.store.workspace.playerBanners)[steam(100)];
  assert.equal(profile.heroes[0].matches, 8);
  assert.equal(profile.peakRank.name, "Ascendant VI");
  assert.equal(profile.lastRank.name, "Phantom IV");
  assert.equal(profile.rankMatches, 2);
  assert.equal(profile.historyMatches, 2);
  let output = playerBannersOutput(f.store.workspace);
  assert.equal(output.scopeLabel, "Season 1 · ranked");
  assert.equal(output.rankLabel, "Recorded peak");
  assert.equal(output.teams[0].players[0].rank.name, "Ascendant VI");
  assert.equal(output.teams[0].players[0].heroes[0].winRate, 62.5);
  f.store.workspace.playerBanners.rankBasis = "last";
  output = playerBannersOutput(f.store.workspace);
  assert.equal(output.teams[0].players[0].rank.name, "Phantom IV");
  assert.equal(output.rankLabel, "Last recorded rank");
  assert.equal(JSON.stringify(output).includes("rankNote"), false);
  assert.equal(JSON.stringify(output).includes(steam(100)), false);
});

test("all-time, season one and season two caches and cooldowns are independent", async () => {
  const f = fixture({ count: 2 });
  await f.service.refresh();
  const allTime = structuredClone(f.store.workspace.playerBanners.profiles);
  const seasonal = seasonFixture();
  f.service.fetch = seasonal.service.fetch;
  f.store.workspace.playerBanners.statsScope = "season_1";
  assert.deepEqual(
    playerBannersOutput(f.store.workspace).teams[0].players[0].heroes,
    [],
  );
  await f.service.refresh();
  const first = structuredClone(
    f.store.workspace.playerBanners.seasonalProfiles.season_1,
  );
  f.store.workspace.playerBanners.statsScope = "season_2";
  await f.service.refresh();
  assert.equal(
    playerBannersOutput(f.store.workspace).teams[0].players[0].rank.name,
    "Eternus II",
  );
  assert.deepEqual(f.store.workspace.playerBanners.profiles, allTime);
  assert.deepEqual(
    f.store.workspace.playerBanners.seasonalProfiles.season_1,
    first,
  );
  f.store.workspace.playerBanners.statsScope = "season_1";
  const calls = seasonal.calls.length;
  await f.service.refresh();
  assert.equal(seasonal.calls.length, calls);
  await assert.rejects(
    f.service.refresh({ force: true }),
    (error) => error.status === 429,
  );
  assert.equal(
    playerBannersOutput(f.store.workspace).teams[0].players[0].rank.name,
    "Ascendant VI",
  );
  f.store.workspace.playerBanners.statsScope = "all";
  assert.equal(
    playerBannersOutput(f.store.workspace).teams[0].players[0].rank.name,
    "Eternus V",
  );
});

test("season rank absence and latest unknown badge never fall back to a current or older rank", async () => {
  const f = seasonFixture({
    fetcher: async (url) => {
      if (!url.pathname.endsWith("match-history")) return;
      const account_id = Number(url.pathname.split("/")[3]);
      return response(
        account_id === 100
          ? [
              {
                account_id,
                match_id: 1,
                game_mode: 1,
                match_mode: 4,
                start_time: 1785430900,
                ranked_display_badge: 111,
              },
              {
                account_id,
                match_id: 2,
                game_mode: 1,
                match_mode: 4,
                start_time: 1785431000,
                ranked_display_badge: null,
              },
            ]
          : [
              {
                account_id,
                match_id: 3,
                game_mode: 1,
                match_mode: 4,
                start_time: 1785431000,
                ranked_display_badge: 0,
              },
            ],
      );
    },
  });
  f.store.workspace.playerBanners.profiles[steam(100)] = {
    rank: { tier: 11, subrank: 6 },
  };
  await f.service.refresh();
  const profiles = bannerProfiles(f.store.workspace.playerBanners);
  assert.equal(profiles[steam(100)].peakRank.name, "Eternus I");
  assert.equal(profiles[steam(100)].lastRank, null);
  assert.match(profiles[steam(100)].rankNote, /1 of 2/);
  assert.equal(profiles[steam(101)].peakRank, null);
  assert.equal(profiles[steam(101)].lastRank, null);
  assert.match(profiles[steam(101)].rankNote, /current rank is not used/);
  f.store.workspace.playerBanners.rankBasis = "last";
  assert.equal(
    playerBannersOutput(f.store.workspace).teams[0].players[0].rank,
    null,
  );
});

test("season definitions must be verified and changed windows cannot reuse cached stats", async () => {
  const f = seasonFixture();
  await f.service.refresh();
  f.advance(3600000);
  f.definitions[0].intervals[0].start_timestamp = 1785432000;
  const original = f.service.fetch;
  f.service.fetch = async (url) =>
    url.includes("hero-stats") ? response({}, { status: 500 }) : original(url);
  await f.service.refresh();
  const profile = bannerProfiles(f.store.workspace.playerBanners)[steam(100)];
  assert.deepEqual(profile.heroes, []);
  assert.equal(profile.peakRank, null);
  assert.equal(profile.status, "error");
  const missing = seasonFixture({
    fetcher: async (url) =>
      url.pathname.endsWith("ranked-seasons") ? response([]) : undefined,
  });
  await assert.rejects(missing.service.refresh(), /Verified dates/);
  assert.equal(missing.store.saves, 0);
  assert.equal(missing.calls.length, 1);
});

test("scope changes while fetching reject stale commits even for the same roster", async () => {
  for (const nextScope of ["all", "season_2"]) {
    const f = seasonFixture();
    const original = f.service.fetch;
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    f.service.fetch = async (url) => {
      await gate;
      return original(url);
    };
    const pending = f.service.refresh();
    f.store.workspace.playerBanners.statsScope = nextScope;
    release();
    await assert.rejects(pending, (error) => error.status === 409);
    assert.equal(f.store.saves, 0);
    assert.deepEqual(f.store.workspace.playerBanners.seasonalProfiles, {});
  }
});

test("historical badge selection deduplicates matches and rejects conflicting or foreign-account rows", () => {
  const window = bannerSeasonWindow(seasonDefinitions(), "season_1");
  const row = {
    account_id: 100,
    match_id: 1,
    match_mode: 4,
    game_mode: 1,
    start_time: window.start,
    ranked_display_badge: 85,
  };
  assert.equal(
    seasonalBannerRanks([row, { ...row }], 100, window).historyMatches,
    1,
  );
  assert.throws(() =>
    seasonalBannerRanks(
      [row, { ...row, ranked_display_badge: 106 }],
      100,
      window,
    ),
  );
  assert.throws(() =>
    seasonalBannerRanks([{ ...row, account_id: 101 }], 100, window),
  );
  assert.equal(
    seasonalBannerRanks([{ ...row, start_time: window.end }], 100, window)
      .historyMatches,
    0,
  );
});

test("season cache persistence failures roll back the complete workspace", async () => {
  const f = seasonFixture();
  const previous = structuredClone(f.store.workspace);
  f.store.saveWorkspace = () => {
    throw Error("Persistence unavailable");
  };
  await assert.rejects(f.service.refresh(), /Persistence unavailable/);
  assert.deepEqual(f.store.workspace, previous);
});

test("multiple game intervals merge hero counts before selecting top heroes and requests stay bounded", async () => {
  let active = 0,
    maximum = 0;
  const f = seasonFixture({
    fetcher: async (url) => {
      if (url.pathname.endsWith("ranked-seasons"))
        return response([
          {
            class_name: "season_1",
            ranked_type: "normal",
            intervals: [
              { interval: 1, start_timestamp: 100, end_timestamp: 200 },
              { interval: 2, start_timestamp: 300, end_timestamp: 400 },
            ],
          },
        ]);
      if (url.pathname.endsWith("hero-stats")) {
        active++;
        maximum = Math.max(maximum, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active--;
        const first = url.searchParams.get("min_unix_timestamp") === "100";
        return response(
          [100, 101].flatMap((account_id) => [
            {
              account_id,
              hero_id: 1,
              matches_played: first ? 8 : 9,
              wins: first ? 4 : 5,
            },
            { account_id, hero_id: first ? 2 : 3, matches_played: 12, wins: 6 },
          ]),
        );
      }
    },
  });
  await f.service.refresh();
  assert.ok(maximum <= 2);
  const profile = bannerProfiles(f.store.workspace.playerBanners)[steam(100)];
  assert.deepEqual(profile.heroes[0], { heroId: 1, matches: 17, wins: 9 });
  const queries = f.calls
    .filter(({ url }) => url.includes("hero-stats"))
    .map(({ url }) => new URL(url).searchParams);
  assert.deepEqual(
    queries.map((q) => [
      q.get("min_unix_timestamp"),
      q.get("max_unix_timestamp"),
    ]),
    [
      ["100", "199"],
      ["300", "399"],
    ],
  );
});

test("season refresh honors upstream cooldown before issuing the remaining history requests", async () => {
  const f = seasonFixture({
    fetcher: async (url) =>
      url.pathname.endsWith("hero-stats")
        ? response([], { status: 429, headers: { "Retry-After": "120" } })
        : undefined,
  });
  await f.service.refresh();
  assert.equal(
    f.calls.some(({ url }) => url.includes("match-history")),
    false,
  );
  assert.equal(
    bannerProfiles(f.store.workspace.playerBanners)[steam(100)].status,
    "error",
  );
  await assert.rejects(
    f.service.refresh(),
    (error) => error.status === 429 && error.retryAfter === 120,
  );
});

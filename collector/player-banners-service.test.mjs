import test from "node:test";
import assert from "node:assert/strict";
import { PlayerBannersService } from "./player-banners-service.mjs";
import {
  cleanPlayerBanners,
  playerBannersOutput,
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

import {
  cleanPlayerBanners,
  normalizeBannerSteamId,
  resolveBannerTeams,
  bannerProfiles,
  bannerSeasonWindow,
} from "../src/player-banners.js";

const API = "https://api.deadlock-api.com";
const STEAM_BASE = 76561197960265728n;
const CACHE_MS = 15 * 60 * 1000;
const FORCE_MS = 60 * 1000;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_RETRY_SECONDS = 3600;
const endpoints = {
  heroes: "/v1/players/hero-stats",
  rank: "/v1/players/rank",
  steam: "/v1/players/steam",
};
const labels = {
  heroes: "Hero statistics",
  rank: "Rank information",
  steam: "Steam profile names",
};
const fail = (message, status = 400, retryAfter) => {
  throw Object.assign(Error(message), {
    status,
    ...(retryAfter ? { retryAfter } : {}),
  });
};
const clock = (now) => Math.max(0, Math.floor(Number(now()) || 0));
const accountId = (value) => {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d{1,10}$/.test(value)
        ? Number(value)
        : NaN;
  return Number.isSafeInteger(number) && number > 0 && number <= 4294967295
    ? number
    : null;
};
const roster = (workspace) =>
  resolveBannerTeams(workspace)
    .flatMap((team) =>
      team.players.map((player) => normalizeBannerSteamId(player.steamId)),
    )
    .filter(Boolean);
const rosterKey = (workspace) => JSON.stringify(roster(workspace));
const count = (value) => Number.isSafeInteger(value) && value >= 0;

function retrySeconds(header, now) {
  let seconds = Number(header);
  if (!header || !Number.isFinite(seconds)) {
    const date = Date.parse(header || "");
    seconds = Number.isFinite(date) ? Math.ceil((date - now) / 1000) : 60;
  }
  return Math.max(1, Math.min(MAX_RETRY_SECONDS, Math.ceil(seconds)));
}

async function readJson(response, maximum = MAX_BODY_BYTES) {
  const length = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(length) && length > maximum) throw Error("size");
  let body;
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maximum) throw Error("size");
        chunks.push(value);
      }
      body = Buffer.concat(chunks).toString("utf8");
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    } finally {
      reader.releaseLock();
    }
  } else {
    body = await response.text();
    if (Buffer.byteLength(body, "utf8") > maximum) throw Error("size");
  }
  const data = JSON.parse(body);
  if (!Array.isArray(data)) throw Error("shape");
  return data;
}

const sameWindow = (a, b) =>
  JSON.stringify(a?.intervals) === JSON.stringify(b?.intervals);
const inSeason = (time, window) =>
  Number.isSafeInteger(time) &&
  window.intervals.some(
    (interval) => time >= interval.start && time < interval.end,
  );
const badgeRank = (badge) =>
  Number.isInteger(badge) &&
  badge >= 11 &&
  badge <= 116 &&
  badge % 10 >= 1 &&
  badge % 10 <= 6
    ? { tier: Math.floor(badge / 10), subrank: badge % 10 }
    : null;

// These are recorded after-match badges, not an assertion that the API knows
// every match or Valve's awarded season-end medal. Never substitute current rank.
export function seasonalBannerRanks(rows, account, window) {
  if (
    !Array.isArray(rows) ||
    rows.length > 20000 ||
    rows.some((row) => accountId(row?.account_id) !== account)
  )
    throw Error("history");
  const matches = new Map();
  for (const row of rows) {
    if (
      row.match_mode !== 4 ||
      row.game_mode !== 1 ||
      !inSeason(row.start_time, window)
    )
      continue;
    if (!Number.isSafeInteger(row.match_id) || row.match_id <= 0)
      throw Error("history");
    const previous = matches.get(row.match_id);
    if (
      previous &&
      (previous.start_time !== row.start_time ||
        previous.ranked_display_badge !== row.ranked_display_badge)
    )
      throw Error("history");
    matches.set(row.match_id, row);
  }
  const history = [...matches.values()].sort(
    (a, b) => b.start_time - a.start_time || b.match_id - a.match_id,
  );
  const ranked = history.filter((row) => badgeRank(row.ranked_display_badge));
  const peak = ranked.reduce(
    (best, row) => Math.max(best, row.ranked_display_badge),
    0,
  );
  const total = history.length;
  return {
    peakRank: badgeRank(peak),
    lastRank: badgeRank(history[0]?.ranked_display_badge),
    rankMatches: ranked.length,
    historyMatches: total,
    rankNote: !total
      ? "No ranked matches for this season are available in tracked history."
      : !ranked.length
        ? "Historical rank badges are unavailable for this season; current rank is not used."
        : `Recorded badges available for ${ranked.length} of ${total} tracked ranked matches. Last recorded rank uses the latest tracked match; neither value certifies a season-end medal.`,
  };
}

async function mapLimited(values, task) {
  const result = new Array(values.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(2, values.length) }, async () => {
      while (next < values.length) {
        const index = next++;
        result[index] = await task(values[index], index);
      }
    }),
  );
  return result;
}

export class PlayerBannersService {
  constructor(store, { fetch: fetcher = fetch, now = Date.now } = {}) {
    this.store = store;
    this.fetch = fetcher;
    this.now = now;
    this.inFlight = new Map();
    this.retryUntil = 0;
    this.seasonDefinitions = null;
  }

  async request(path, label, maximum = MAX_BODY_BYTES) {
    const wait = this.retryUntil - clock(this.now);
    if (wait > 0)
      return {
        ok: false,
        error: `The player statistics service is busy. Try again in ${Math.ceil(wait / 1000)} seconds.`,
      };
    try {
      const response = await this.fetch(`${API}${path}`, {
        signal: AbortSignal.timeout(12000),
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        if ([429, 503, 504].includes(response.status)) {
          const now = clock(this.now);
          const seconds = retrySeconds(
            response.headers?.get?.("retry-after"),
            now,
          );
          this.retryUntil = Math.max(this.retryUntil, now + seconds * 1000);
          return {
            ok: false,
            error: `The player statistics service is busy. Try again in ${seconds} seconds.`,
          };
        }
        return {
          ok: false,
          error: `${label} could not be refreshed. Try again later.`,
        };
      }
      return { ok: true, rows: await readJson(response, maximum) };
    } catch {
      return {
        ok: false,
        error: `${label} could not be refreshed. Try again later.`,
      };
    }
  }

  batch(kind, ids, filters = {}) {
    const query = new URLSearchParams({
      account_ids: ids.join(","),
      ...filters,
    });
    return this.request(`${endpoints[kind]}?${query}`, labels[kind]);
  }

  async refresh(value = {}) {
    const workspace = this.store.workspace;
    const tournamentId = workspace.activeTournamentId || "";
    const key = JSON.stringify([
      tournamentId,
      cleanPlayerBanners(workspace.playerBanners).statsScope,
      rosterKey(workspace),
    ]);
    if (this.inFlight.has(key)) return this.inFlight.get(key);
    const pending = this.refreshRoster(value, workspace, tournamentId);
    this.inFlight.set(key, pending);
    try {
      return await pending;
    } finally {
      if (this.inFlight.get(key) === pending) this.inFlight.delete(key);
    }
  }

  async refreshRoster(value, workspace, tournamentId) {
    const now = clock(this.now);
    const settings = cleanPlayerBanners(workspace.playerBanners);
    if (settings.statsScope !== "all")
      return this.refreshSeasonRoster(value, workspace, tournamentId, settings);
    const section = workspace.playerBanners;
    const selection = rosterKey(workspace);
    const allIds = [...new Set(roster(workspace))].slice(0, 12);
    if (!allIds.length)
      fail(
        "Add Steam accounts to the selected players before refreshing their statistics.",
      );
    if (this.retryUntil > now) {
      const seconds = Math.ceil((this.retryUntil - now) / 1000);
      fail(
        `The player statistics service is busy. Try again in ${seconds} seconds.`,
        429,
        seconds,
      );
    }
    const ids = allIds.filter((id) => {
      const profile = settings.profiles[id];
      if (profile?.fetchedAt && now - profile.fetchedAt < FORCE_MS)
        return false;
      if (value?.force === true) return true;
      return (
        !profile ||
        profile.status === "error" ||
        !profile.updatedAt ||
        now - profile.updatedAt >= CACHE_MS
      );
    });
    if (!ids.length) {
      if (
        value?.force === true ||
        allIds.some((id) => settings.profiles[id]?.status === "error")
      ) {
        const seconds = Math.max(
          1,
          Math.ceil(
            Math.min(
              ...allIds.map(
                (id) => FORCE_MS - (now - settings.profiles[id].fetchedAt),
              ),
            ) / 1000,
          ),
        );
        fail(
          `These players were just refreshed. Try again in ${seconds} seconds.`,
          429,
          seconds,
        );
      }
      return workspace;
    }
    const accountIds = ids.map((id) => Number(BigInt(id) - STEAM_BASE));
    const results = Object.fromEntries(
      await Promise.all(
        Object.keys(endpoints).map(async (kind) => [
          kind,
          await this.batch(kind, accountIds),
        ]),
      ),
    );
    const current = this.store.workspace;
    if (
      current !== workspace ||
      (current.activeTournamentId || "") !== tournamentId ||
      current.playerBanners !== section ||
      cleanPlayerBanners(current.playerBanners).statsScope !==
        settings.statsScope ||
      rosterKey(current) !== selection
    )
      fail(
        "Tournament or player selection changed. Refresh the selected teams again.",
        409,
      );

    const attemptedAt = clock(this.now);
    const updates = {};
    for (let index = 0; index < ids.length; index++) {
      const id = ids[index];
      const account = accountIds[index];
      const previous = settings.profiles[id];
      const next = {
        personaName: previous?.personaName || "",
        heroes: previous?.heroes || [],
        rank: previous?.rank || null,
        updatedAt: previous?.updatedAt || 0,
        fetchedAt: attemptedAt,
        status: "ready",
        error: "",
      };
      const errors = [];
      for (const kind of Object.keys(endpoints)) {
        const result = results[kind];
        if (!result.ok) {
          errors.push(result.error);
          continue;
        }
        const rows = result.rows.filter(
          (row) => accountId(row?.account_id) === account,
        );
        if (kind === "heroes") {
          if (
            rows.some(
              (row) =>
                !Number.isSafeInteger(row.hero_id) ||
                row.hero_id <= 0 ||
                !count(row.matches_played) ||
                !count(row.wins) ||
                row.wins > row.matches_played,
            )
          ) {
            errors.push(
              "Hero statistics are temporarily unavailable. Try again later.",
            );
            continue;
          }
          next.heroes = rows.map((row) => ({
            heroId: row.hero_id,
            matches: row.matches_played,
            wins: row.wins,
          }));
          next.updatedAt = attemptedAt;
        } else if (kind === "rank") {
          const rank = rows[0];
          if (!rank) {
            next.rank = null;
            errors.push("Rank information is unavailable for this player.");
          } else if (
            rank.badge === 0 &&
            rank.rank === 0 &&
            rank.subrank === 0
          ) {
            next.rank = null;
          } else if (
            Number.isInteger(rank.rank) &&
            rank.rank >= 1 &&
            rank.rank <= 11 &&
            Number.isInteger(rank.subrank) &&
            rank.subrank >= 0 &&
            rank.subrank <= 6 &&
            rank.badge === rank.rank * 10 + rank.subrank &&
            rank.last_match
          ) {
            next.rank = { tier: rank.rank, subrank: rank.subrank };
          } else {
            errors.push(
              "Rank information is temporarily unavailable. Try again later.",
            );
          }
        } else if (rows[0] && typeof rows[0].personaname === "string") {
          next.personaName = rows[0].personaname;
        }
      }
      if (errors.length) {
        next.status = "error";
        next.error = [...new Set(errors)].join(" ").slice(0, 240);
      } else {
        next.status = next.heroes.some((hero) => hero.matches > 0)
          ? "ready"
          : "empty";
        next.updatedAt = attemptedAt;
      }
      updates[id] = next;
    }
    const priorSettings = current.playerBanners;
    const priorRevision = current.revision;
    const currentSettings = cleanPlayerBanners(priorSettings);
    const profiles = Object.fromEntries(
      Object.entries(currentSettings.profiles).filter(
        ([id]) => !Object.hasOwn(updates, id),
      ),
    );
    current.playerBanners = cleanPlayerBanners({
      ...currentSettings,
      profiles: { ...profiles, ...updates },
    });
    current.revision++;
    try {
      this.store.saveWorkspace();
    } catch (error) {
      current.playerBanners = priorSettings;
      current.revision = priorRevision;
      throw error;
    }
    return current;
  }

  async refreshSeasonRoster(value, workspace, tournamentId, settings) {
    const section = workspace.playerBanners;
    const selection = rosterKey(workspace);
    const scope = settings.statsScope;
    const allIds = [...new Set(roster(workspace))].slice(0, 12);
    if (!allIds.length)
      fail(
        "Add Steam accounts to the selected players before refreshing their statistics.",
      );
    const now = clock(this.now);
    if (this.retryUntil > now) {
      const seconds = Math.ceil((this.retryUntil - now) / 1000);
      fail(
        `The player statistics service is busy. Try again in ${seconds} seconds.`,
        429,
        seconds,
      );
    }
    let definitions = this.seasonDefinitions;
    if (!definitions || now - definitions.at >= 3600000) {
      const response = await this.request(
        "/v1/assets/ranked-seasons?language=english",
        "Ranked season definitions",
      );
      if (!response.ok) fail(response.error, 503);
      definitions = { at: now, rows: response.rows };
      this.seasonDefinitions = definitions;
    }
    const window = bannerSeasonWindow(definitions.rows, scope);
    if (!window)
      fail(
        "Verified dates for this ranked season are unavailable. No all-time or current-season statistics were substituted.",
        503,
      );
    const oldCache = settings.seasonalProfiles[scope];
    const profiles = sameWindow(oldCache, window)
      ? bannerProfiles(settings)
      : {};
    const ids = allIds.filter((id) => {
      const profile = profiles[id];
      if (profile?.fetchedAt && now - profile.fetchedAt < FORCE_MS)
        return false;
      return (
        value?.force === true ||
        !profile ||
        profile.status === "error" ||
        !profile.updatedAt ||
        now - profile.updatedAt >= CACHE_MS
      );
    });
    if (!ids.length) {
      if (
        value?.force === true ||
        allIds.some((id) => profiles[id]?.status === "error")
      ) {
        const seconds = Math.max(
          1,
          Math.ceil(
            Math.min(
              ...allIds.map((id) => FORCE_MS - (now - profiles[id].fetchedAt)),
            ) / 1000,
          ),
        );
        fail(
          `These players were just refreshed. Try again in ${seconds} seconds.`,
          429,
          seconds,
        );
      }
      return workspace;
    }
    const accounts = ids.map((id) => Number(BigInt(id) - STEAM_BASE));
    // Bound uncached database requests: do not send twelve history queries at once.
    const steam = await this.batch("steam", accounts);
    const heroResults = await mapLimited(window.intervals, (interval) =>
      this.batch("heroes", accounts, {
        game_mode: "normal",
        match_mode: "ranked",
        min_unix_timestamp: String(interval.start),
        max_unix_timestamp: String(interval.end - 1),
      }),
    );
    const histories = await mapLimited(accounts, (account) =>
      this.request(
        `/v1/players/${account}/match-history`,
        "Historical rank information",
        10 * 1024 * 1024,
      ),
    );
    const current = this.store.workspace;
    if (
      current !== workspace ||
      (current.activeTournamentId || "") !== tournamentId ||
      current.playerBanners !== section ||
      rosterKey(current) !== selection ||
      cleanPlayerBanners(current.playerBanners).statsScope !== scope
    )
      fail(
        "Tournament, statistics period or player selection changed. Refresh the selected teams again.",
        409,
      );
    const attemptedAt = clock(this.now);
    const updates = {};
    for (const [index, id] of ids.entries()) {
      const account = accounts[index];
      const previous = profiles[id];
      const next = {
        personaName: previous?.personaName || "",
        heroes: previous?.heroes || [],
        rank: null,
        peakRank: previous?.peakRank || null,
        lastRank: previous?.lastRank || null,
        rankMatches: previous?.rankMatches || 0,
        historyMatches: previous?.historyMatches || 0,
        rankNote:
          previous?.rankNote || "Historical rank information is unavailable.",
        updatedAt: previous?.updatedAt || 0,
        fetchedAt: attemptedAt,
        status: "ready",
        error: "",
      };
      const errors = [];
      if (steam.ok) {
        const row = steam.rows.find(
          (item) => accountId(item?.account_id) === account,
        );
        if (typeof row?.personaname === "string")
          next.personaName = row.personaname;
      } else errors.push(steam.error);
      if (heroResults.every((result) => result.ok)) {
        const rows = heroResults
          .flatMap((result) => result.rows)
          .filter((row) => accountId(row?.account_id) === account);
        if (
          rows.some(
            (row) =>
              !Number.isSafeInteger(row.hero_id) ||
              row.hero_id <= 0 ||
              !count(row.matches_played) ||
              !count(row.wins) ||
              row.wins > row.matches_played,
          )
        ) {
          errors.push(
            "Ranked hero statistics are temporarily unavailable. Try again later.",
          );
        } else {
          const merged = new Map();
          for (const row of rows) {
            const hero = merged.get(row.hero_id) || {
              heroId: row.hero_id,
              matches: 0,
              wins: 0,
            };
            hero.matches += row.matches_played;
            hero.wins += row.wins;
            merged.set(row.hero_id, hero);
          }
          next.heroes = [...merged.values()];
          next.updatedAt = attemptedAt;
        }
      } else
        errors.push(
          ...heroResults
            .filter((result) => !result.ok)
            .map((result) => result.error),
        );
      const history = histories[index];
      if (history.ok) {
        try {
          Object.assign(
            next,
            seasonalBannerRanks(history.rows, account, window),
          );
        } catch {
          next.rankNote =
            "Historical rank information could not be verified. No current rank was substituted.";
          next.peakRank = null;
          next.lastRank = null;
          next.rankMatches = 0;
          next.historyMatches = 0;
        }
      } else {
        next.rankNote = previous?.rankMatches
          ? "Last available historical badges. The latest refresh failed."
          : "Historical rank information is unavailable. No current rank was substituted.";
      }
      if (errors.length) {
        next.status = "error";
        next.error = [...new Set(errors)].join(" ").slice(0, 240);
      } else {
        next.status = next.heroes.some((hero) => hero.matches > 0)
          ? "ready"
          : "empty";
        next.updatedAt = attemptedAt;
      }
      updates[id] = next;
    }
    const prior = current.playerBanners;
    const revision = current.revision;
    const clean = cleanPlayerBanners(prior);
    const retained = Object.fromEntries(
      Object.entries(profiles).filter(([id]) => !Object.hasOwn(updates, id)),
    );
    current.playerBanners = cleanPlayerBanners({
      ...clean,
      seasonalProfiles: {
        ...clean.seasonalProfiles,
        [scope]: { ...window, profiles: { ...retained, ...updates } },
      },
    });
    current.revision++;
    try {
      this.store.saveWorkspace();
    } catch (error) {
      current.playerBanners = prior;
      current.revision = revision;
      throw error;
    }
    return current;
  }
}

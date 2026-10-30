import {
  cleanPlayerBanners,
  normalizeBannerSteamId,
  resolveBannerTeams,
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

async function readJson(response) {
  const length = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) throw Error("size");
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
        if (size > MAX_BODY_BYTES) throw Error("size");
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
    if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) throw Error("size");
  }
  const data = JSON.parse(body);
  if (!Array.isArray(data)) throw Error("shape");
  return data;
}

export class PlayerBannersService {
  constructor(store, { fetch: fetcher = fetch, now = Date.now } = {}) {
    this.store = store;
    this.fetch = fetcher;
    this.now = now;
    this.inFlight = new Map();
    this.retryUntil = 0;
  }

  async batch(kind, ids) {
    try {
      const response = await this.fetch(
        `${API}${endpoints[kind]}?account_ids=${ids.join(",")}`,
        {
          signal: AbortSignal.timeout(12000),
          headers: { Accept: "application/json" },
        },
      );
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
          error: `${labels[kind]} could not be refreshed. Try again later.`,
        };
      }
      return { ok: true, rows: await readJson(response) };
    } catch {
      return {
        ok: false,
        error: `${labels[kind]} could not be refreshed. Try again later.`,
      };
    }
  }

  async refresh(value = {}) {
    const workspace = this.store.workspace;
    const tournamentId = workspace.activeTournamentId || "";
    if (this.inFlight.has(tournamentId)) return this.inFlight.get(tournamentId);
    const pending = this.refreshRoster(value, workspace, tournamentId);
    this.inFlight.set(tournamentId, pending);
    try {
      return await pending;
    } finally {
      if (this.inFlight.get(tournamentId) === pending)
        this.inFlight.delete(tournamentId);
    }
  }

  async refreshRoster(value, workspace, tournamentId) {
    const now = clock(this.now);
    const settings = cleanPlayerBanners(workspace.playerBanners);
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
}

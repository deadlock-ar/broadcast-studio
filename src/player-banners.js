import { safeImage } from "./draft.js";
import { cleanBracket, rosterSlots } from "./bracket.js";

const STEAM_BASE = 76561197960265728n;
const MAX_ACCOUNT = 4294967295n;
const RANK_NAMES = [
  "Obscurus",
  "Initiate",
  "Seeker",
  "Acolyte",
  "Sentinel",
  "Mystic",
  "Ritualist",
  "Emissary",
  "Oracle",
  "Phantom",
  "Ascendant",
  "Eternus",
];
const DIVISIONS = ["", "I", "II", "III", "IV", "V", "VI"];
const text = (value, maximum = 80) =>
  typeof value === "string" ? value.trim().slice(0, maximum) : "";
const identifier = (value) =>
  typeof value === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(value)
    ? value
    : "";
const integer = (value, maximum = 10000000) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(maximum, Math.floor(value)))
    : 0;
const timestamp = (value) => integer(value, 8640000000000000);
const label = (value) => text(value).toLocaleLowerCase();

// Numeric Steam profiles and account IDs can be normalized without a network
// request. Keep IDs as strings so their 64-bit values are never rounded.
export function normalizeBannerSteamId(value = "") {
  if (
    typeof value !== "string" &&
    !(typeof value === "number" && Number.isSafeInteger(value))
  )
    return "";
  let input = String(value).trim();
  if (/^https?:\/\//i.test(input)) {
    try {
      const url = new URL(input);
      const match = /^\/profiles\/(\d+)\/?$/.exec(url.pathname);
      if (
        !["steamcommunity.com", "www.steamcommunity.com"].includes(
          url.hostname,
        ) ||
        url.username ||
        url.password ||
        url.port ||
        !match
      )
        return "";
      input = match[1];
    } catch {
      return "";
    }
  }
  if (!/^\d{1,20}$/.test(input)) return "";
  const number = BigInt(input);
  if (number > 0n && number <= MAX_ACCOUNT) return String(STEAM_BASE + number);
  if (number > STEAM_BASE && number <= STEAM_BASE + MAX_ACCOUNT)
    return String(number);
  return "";
}

function player(value) {
  return {
    id: identifier(value?.id),
    name: text(value?.name, 48),
    steamId: normalizeBannerSteamId(value?.steamId),
  };
}

function team(value) {
  return {
    id: identifier(value?.id),
    name: text(value?.name),
    tag: text(value?.tag, 8),
    logo: safeImage(value?.logo),
    players: rosterSlots(value?.players).slice(0, 6).map(player),
  };
}

function rank(value) {
  const tier = value?.tier;
  const subrank = value?.subrank;
  if (
    !Number.isInteger(tier) ||
    tier < 1 ||
    tier > 11 ||
    !Number.isInteger(subrank) ||
    subrank < 0 ||
    subrank > 6
  )
    return null;
  return {
    tier,
    subrank,
    name: `${RANK_NAMES[tier]}${subrank ? ` ${DIVISIONS[subrank]}` : ""}`,
    image: subrank
      ? `https://api.deadlock-api.com/v1/assets/ranks/${tier}/${subrank}/image?format=webp`
      : `https://assets-bucket.deadlock-api.com/assets-api-res/images/ranks/rank${String(tier).padStart(2, "0")}_lg.webp`,
  };
}

function profile(value, seasonal = false) {
  const seen = new Set();
  const heroes = (Array.isArray(value?.heroes) ? value.heroes : [])
    .slice(0, 200)
    .flatMap((hero) => {
      const heroId = integer(hero?.heroId, 1000000);
      const matches = integer(hero?.matches);
      if (!heroId || !matches || seen.has(heroId)) return [];
      seen.add(heroId);
      return [
        { heroId, matches, wins: Math.min(matches, integer(hero?.wins)) },
      ];
    })
    .sort((a, b) => b.matches - a.matches || a.heroId - b.heroId)
    .slice(0, 3);
  return {
    personaName: text(value?.personaName, 48),
    heroes,
    rank: rank(value?.rank),
    updatedAt: timestamp(value?.updatedAt),
    fetchedAt: timestamp(value?.fetchedAt),
    status: ["ready", "empty", "error"].includes(value?.status)
      ? value.status
      : heroes.length
        ? "ready"
        : "empty",
    error: text(value?.error, 240),
    ...(seasonal
      ? {
          peakRank: rank(value?.peakRank),
          lastRank: rank(value?.lastRank),
          rankMatches: integer(value?.rankMatches),
          historyMatches: integer(value?.historyMatches),
          rankNote: text(value?.rankNote, 240),
        }
      : {}),
  };
}

function cleanProfiles(value, seasonal = false) {
  return Object.fromEntries(
    Object.entries(
      value && typeof value === "object" && !Array.isArray(value) ? value : {},
    )
      .filter(([key]) => normalizeBannerSteamId(key) === key)
      .slice(-64)
      .map(([key, item]) => [key, profile(item, seasonal)]),
  );
}

export const BANNER_SCOPES = [
  { id: "all", label: "All time" },
  { id: "season_1", label: "Season 1 · ranked" },
  { id: "season_2", label: "Season 2 · ranked" },
];

// Use the game's season definitions, never inferred dates or the current rank.
// Consecutive seasons share a boundary; the newer interval owns that second.
export function bannerSeasonWindow(rows, scope) {
  if (!["season_1", "season_2"].includes(scope) || !Array.isArray(rows))
    return null;
  const candidates = rows.filter(
    (item) => item?.class_name === scope && item?.ranked_type === "normal",
  );
  if (candidates.length !== 1) return null;
  const raw = candidates[0].intervals;
  if (!Array.isArray(raw) || !raw.length || raw.length > 8) return null;
  const intervals = raw.map((item) => ({
    id: item?.interval,
    start: item?.start_timestamp,
    end: item?.end_timestamp,
  }));
  if (
    new Set(intervals.map((item) => item.id)).size !== intervals.length ||
    intervals.some(
      (item) =>
        !Number.isSafeInteger(item.id) ||
        item.id < 1 ||
        !Number.isSafeInteger(item.start) ||
        item.start <= 0 ||
        !Number.isSafeInteger(item.end) ||
        item.end <= item.start,
    )
  )
    return null;
  intervals.sort((a, b) => a.start - b.start);
  if (
    intervals.some(
      (item, index) => index && item.start < intervals[index - 1].end,
    )
  )
    return null;
  return {
    scope,
    intervals,
    start: intervals[0].start,
    end: intervals.at(-1).end,
  };
}

function cleanSeasonCache(value, scope) {
  const window = bannerSeasonWindow(
    [
      {
        class_name: scope,
        ranked_type: "normal",
        intervals: Array.isArray(value?.intervals)
          ? value.intervals.map((item) => ({
              interval: item?.id,
              start_timestamp: item?.start,
              end_timestamp: item?.end,
            }))
          : [],
      },
    ],
    scope,
  );
  return window
    ? { ...window, profiles: cleanProfiles(value?.profiles, true) }
    : null;
}

export function bannerProfiles(settings = {}) {
  return settings.statsScope === "all" || !settings.statsScope
    ? settings.profiles || {}
    : settings.seasonalProfiles?.[settings.statsScope]?.profiles || {};
}

export function bannerScopeLabel(scope) {
  return BANNER_SCOPES.find((item) => item.id === scope)?.label || "All time";
}

export function cleanPlayerBanners(value = {}) {
  const seasonalProfiles = {};
  for (const scope of ["season_1", "season_2"]) {
    const cache = cleanSeasonCache(value?.seasonalProfiles?.[scope], scope);
    if (cache) seasonalProfiles[scope] = cache;
  }
  return {
    visible: value?.visible !== false,
    transparent: value?.transparent === true,
    showRanks: value?.showRanks !== false,
    statsScope: BANNER_SCOPES.some((item) => item.id === value?.statsScope)
      ? value.statsScope
      : "all",
    rankBasis: value?.rankBasis === "last" ? "last" : "peak",
    source: ["broadcast", "bracket", "manual"].includes(value?.source)
      ? value.source
      : "broadcast",
    matchId: identifier(value?.matchId),
    teams: [0, 1].map((index) => team(value?.teams?.[index])),
    profiles: cleanProfiles(value?.profiles),
    seasonalProfiles,
  };
}

// Resolve linked rosters afresh rather than copying them into settings. A side
// swap in broadcast branding therefore moves the whole roster with its team.
export function resolveBannerTeams(workspace = {}) {
  const settings = cleanPlayerBanners(workspace.playerBanners);
  const assigned = (value) => ({
    ...team(value),
    resolved: Boolean(text(value?.name)),
  });
  if (settings.source === "manual") return settings.teams.map(assigned);
  const bracket = cleanBracket(workspace.bracket);
  const empty = () => ({ ...team({ name: "To be decided" }), resolved: false });
  if (settings.source === "bracket") {
    const match = bracket.matches.find((item) => item.id === settings.matchId);
    if (!match || !match.required || match.status === "bye")
      return [empty(), empty()];
    return [0, 1].map((index) => {
      const entrant = bracket.entrants.find(
        (item) => item.id === match.teamIds[index],
      );
      return entrant ? assigned(entrant) : empty();
    });
  }
  const branding = [0, 1].map((index) =>
    assigned({
      ...workspace.config?.teams?.[index],
      players: [],
    }),
  );
  const active = bracket.matches.find(
    (item) => item.id === bracket.activeMatchId,
  );
  const activeTeams =
    active?.required && active.teamIds.every(Boolean)
      ? active.teamIds.map((id) =>
          bracket.entrants.find((item) => item.id === id),
        )
      : [];
  const candidates =
    activeTeams.length === 2 &&
    activeTeams.every(Boolean) &&
    branding.every((item) =>
      activeTeams.some((entrant) => label(entrant.name) === label(item.name)),
    )
      ? activeTeams
      : bracket.entrants;
  const resolved = branding.map((item) => {
    const matches = candidates.filter(
      (entrant) => label(entrant.name) === label(item.name),
    );
    if (!item.name || matches.length !== 1) return item;
    const entrant = assigned(matches[0]);
    return {
      ...entrant,
      name: item.name,
      tag: item.tag || entrant.tag,
      logo: item.logo || entrant.logo,
    };
  });
  // Duplicate branding must never accidentally put the same Steam roster on
  // both sides of an unrelated broadcast.
  if (resolved[0].id && resolved[0].id === resolved[1].id) return branding;
  return resolved;
}

export function playerBannersOutput(workspace = {}) {
  const settings = cleanPlayerBanners(workspace.playerBanners);
  const profiles = bannerProfiles(settings);
  const seasonal = settings.statsScope !== "all";
  return {
    title: text(workspace.config?.event, 120),
    visible: settings.visible,
    transparent: settings.transparent,
    showRanks: settings.showRanks,
    statsScope: settings.statsScope,
    scopeLabel: bannerScopeLabel(settings.statsScope),
    rankLabel: seasonal
      ? settings.rankBasis === "last"
        ? "Last recorded rank"
        : "Recorded peak"
      : "Latest reported rank",
    teams: resolveBannerTeams(workspace).map((item) => ({
      name: item.name,
      tag: item.tag,
      logo: item.logo,
      resolved: item.resolved,
      players: item.players.map((person) => {
        const stats = person.steamId ? profiles[person.steamId] : null;
        return {
          name: person.name || stats?.personaName || "",
          heroes: (stats?.heroes || []).map((hero) => ({
            ...hero,
            winRate: Math.round((hero.wins / hero.matches) * 1000) / 10,
          })),
          rank: settings.showRanks
            ? seasonal
              ? stats?.[
                  settings.rankBasis === "last" ? "lastRank" : "peakRank"
                ] || null
              : stats?.rank || null
            : null,
          status: stats?.status || "missing",
          updatedAt: stats?.updatedAt || 0,
        };
      }),
    })),
  };
}

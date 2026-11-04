import { safeImage } from "./draft.js";
import { cleanBracket } from "./bracket.js";

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
    players: Array.from({ length: 6 }, (_, index) =>
      player(value?.players?.[index]),
    ),
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

function profile(value) {
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
  };
}

export function cleanPlayerBanners(value = {}) {
  const profiles = Object.fromEntries(
    Object.entries(
      value?.profiles &&
        typeof value.profiles === "object" &&
        !Array.isArray(value.profiles)
        ? value.profiles
        : {},
    )
      .filter(([key]) => normalizeBannerSteamId(key) === key)
      .slice(-64)
      .map(([key, item]) => [key, profile(item)]),
  );
  return {
    visible: value?.visible !== false,
    transparent: value?.transparent === true,
    showRanks: value?.showRanks !== false,
    source: ["broadcast", "bracket", "manual"].includes(value?.source)
      ? value.source
      : "broadcast",
    matchId: identifier(value?.matchId),
    teams: [0, 1].map((index) => team(value?.teams?.[index])),
    profiles,
  };
}

// Resolve linked rosters afresh rather than copying them into settings. A side
// swap in broadcast branding therefore moves the whole roster with its team.
export function resolveBannerTeams(workspace = {}) {
  const settings = cleanPlayerBanners(workspace.playerBanners);
  if (settings.source === "manual") return settings.teams;
  const bracket = cleanBracket(workspace.bracket);
  const empty = () => team({ name: "To be decided" });
  if (settings.source === "bracket") {
    const match = bracket.matches.find((item) => item.id === settings.matchId);
    if (!match || !match.required || match.status === "bye")
      return [empty(), empty()];
    return [0, 1].map((index) => {
      const entrant = bracket.entrants.find(
        (item) => item.id === match.teamIds[index],
      );
      return entrant ? team(entrant) : empty();
    });
  }
  const branding = [0, 1].map((index) =>
    team({
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
    const entrant = team(matches[0]);
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
  return {
    title: text(workspace.config?.event, 120),
    visible: settings.visible,
    transparent: settings.transparent,
    showRanks: settings.showRanks,
    teams: resolveBannerTeams(workspace).map((item) => ({
      name: item.name,
      tag: item.tag,
      logo: item.logo,
      players: item.players.map((person) => {
        const stats = person.steamId ? settings.profiles[person.steamId] : null;
        return {
          name: person.name || stats?.personaName || "",
          heroes: (stats?.heroes || []).map((hero) => ({
            ...hero,
            winRate: Math.round((hero.wins / hero.matches) * 1000) / 10,
          })),
          rank: settings.showRanks ? stats?.rank || null : null,
          status: stats?.status || "missing",
          updatedAt: stats?.updatedAt || 0,
        };
      }),
    })),
  };
}

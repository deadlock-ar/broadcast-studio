import { safeImage } from "./draft.js";
import { liveRoster } from "./roster-order.js";
import heroes from "./heroes.json" with { type: "json" };

export const MATCH_OVERLAY_FONTS = [
  {
    id: "bodoni",
    label: "Bodoni — classic serif",
    family: "'Match Bodoni', Georgia, serif",
  },
  {
    id: "oswald",
    label: "Oswald — condensed",
    family: "'Match Oswald', 'Arial Narrow', Arial, sans-serif",
  },
  {
    id: "georgia",
    label: "Georgia — serif",
    family: "Georgia, 'Times New Roman', serif",
  },
  {
    id: "arial",
    label: "Arial — sans serif",
    family: "Arial, Helvetica, sans-serif",
  },
  {
    id: "times",
    label: "Times New Roman — serif",
    family: "'Times New Roman', Times, serif",
  },
];
const heroIds = new Set(heroes.map((hero) => Number(hero.id)));
const string = (value, fallback = "", maximum = 120) =>
  typeof value === "string" ? value.slice(0, maximum) : fallback;
const image = (value) => safeImage(value) || null;
const heroId = (value) => (heroIds.has(Number(value)) ? Number(value) : null);
const teamDefaults = [
  { name: "TEAM ALPHA", accent: "#e49d21" },
  { name: "TEAM OMEGA", accent: "#5f8de7" },
];
const bounded = (value, minimum, maximum, fallback) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.round(Math.max(minimum, Math.min(maximum, value)))
    : fallback;
const playerId = (value) =>
  typeof value === "string" && /^\d{1,20}$/.test(value);
const own = (value, key) => Object.hasOwn(value, key);

function cleanPlayerNames(value = {}) {
  if (!value || typeof value !== "object") value = {};
  const layout = value.layout || {};
  const height = bounded(layout.height, 12, 70, 22);
  return {
    enabled: value.enabled === true,
    overrides: Object.fromEntries(
      Object.entries(value.overrides || {})
        .filter(
          ([id, name]) =>
            playerId(id) && typeof name === "string" && name.trim(),
        )
        .slice(0, 256)
        .map(([id, name]) => [id, name.slice(0, 48)]),
    ),
    manual: [0, 1].map((team) =>
      Array.from({ length: 6 }, (_, slot) =>
        string(value.manual?.[team]?.[slot], "", 48),
      ),
    ),
    layout: {
      x: bounded(layout.x, 0, 1919, 326),
      y: bounded(layout.y, 0, 1080 - height, 64),
      width: bounded(layout.width, 24, 250, 94),
      height,
      gap: bounded(layout.gap, 0, 80, 5),
      teamGap: bounded(layout.teamGap, 0, 500, 143),
      fontSize: bounded(layout.fontSize, 8, 30, 14),
    },
  };
}

export function cleanMatchOverlay(value = {}) {
  if (!value || typeof value !== "object") value = {};
  return {
    visible: value.visible !== false,
    backgroundOpacity: bounded(value.backgroundOpacity, 0, 100, 100),
    playerNames: cleanPlayerNames(value.playerNames),
    format: ["linked", "BO1", "BO3"].includes(value.format)
      ? value.format
      : "linked",
    font: MATCH_OVERLAY_FONTS.some((font) => font.id === value.font)
      ? value.font
      : "bodoni",
    links: Object.fromEntries(
      ["names", "bans", "scores", "event"].map((key) => [
        key,
        value.links?.[key] !== false,
      ]),
    ),
    teams: teamDefaults.map((fallback, index) => {
      const team = value.teams?.[index] || {};
      return {
        name: string(team.name, fallback.name, 48),
        accent: /^#[a-f0-9]{6}$/i.test(team.accent || "")
          ? team.accent
          : fallback.accent,
        scoreBoxes: Array.from(
          { length: 4 },
          (_, slot) => team.scoreBoxes?.[slot] === true,
        ),
        bans: Array.from({ length: 3 }, (_, slot) => heroId(team.bans?.[slot])),
      };
    }),
    tournament: {
      name: string(value.tournament?.name, "AR CUP", 80),
      subtitle: string(value.tournament?.subtitle, "COMMUNITY\nTOURNAMENT"),
    },
    sponsor: {
      heading: string(value.sponsor?.heading, "SUPPORTED BY", 48),
      name: string(value.sponsor?.name, "COMMUNITY\nPARTNERS"),
      logo: image(value.sponsor?.logo),
    },
    center: { logo: image(value.center?.logo) },
    hudHeight: 35,
  };
}

export function matchOverlayWins(format) {
  return { BO1: 1, BO3: 2, BO5: 3, BO7: 4 }[format] || 2;
}

// Resolve the current board on every update instead of copying linked fields.
// Clearing/replacing a draft therefore clears old bans immediately, while manual
// overrides stay independent and never write into the source draft or branding.
export function resolveMatchOverlay(workspace = {}, session = null) {
  const settings = cleanMatchOverlay(workspace.matchOverlay);
  const config = workspace.config || {};
  const snapshot = workspace.draft?.snapshot || {};
  const format =
    settings.format === "linked"
      ? ["BO1", "BO3", "BO5", "BO7"].includes(config.format)
        ? config.format
        : "BO3"
      : settings.format;
  const teams = settings.teams.map((manual, index) => {
    const configured = config.teams?.[index] || {};
    const source = snapshot.teams?.find(
      (team) => Number(team.teamNumber) === index + 1,
    );
    const linkedName =
      config.useSourceNames && source?.displayName
        ? source.displayName
        : configured.name;
    const draftBans = (snapshot.steps || [])
      .filter(
        (step) =>
          Number(step.teamNumber) === index + 1 && step.selectionType === "ban",
      )
      .slice(0, 3);
    return {
      ...manual,
      name: settings.links.names
        ? string(linkedName, manual.name, 48)
        : manual.name,
      bans: settings.links.bans
        ? Array.from({ length: 3 }, (_, slot) =>
            heroId(draftBans[slot]?.heroId),
          )
        : manual.bans,
      scoreBoxes: settings.links.scores
        ? Array.from(
            { length: 4 },
            (_, slot) => Number(configured.score) > slot,
          )
        : manual.scoreBoxes,
    };
  });
  return {
    visible: settings.visible,
    backgroundOpacity: settings.backgroundOpacity,
    playerNames: resolvePlayerNames(workspace, session, settings.playerNames),
    format,
    font: settings.font,
    teams,
    tournament: {
      ...settings.tournament,
      name: settings.links.event
        ? string(config.event, settings.tournament.name, 80)
        : settings.tournament.name,
    },
    sponsor: settings.sponsor,
    center: settings.center,
    hudHeight: 35,
  };
}

function resolvePlayerNames(workspace, session, settings) {
  const selected = workspace.deadem?.id || "";
  const current =
    selected &&
    session?.id === selected &&
    (!workspace.activeTournamentId ||
      !session.tournamentId ||
      session.tournamentId === workspace.activeTournamentId)
      ? session
      : null;
  const liveMatch = current?.result?.match || current?.match;
  const apiMatch = !selected ? workspace.apiStats?.result?.match : null;
  const match = liveMatch || apiMatch;
  const source = liveMatch ? "live" : apiMatch ? "api" : "manual";
  const names = liveMatch
    ? current.settings?.names || {}
    : apiMatch
      ? workspace.apiStats?.panel?.names || {}
      : {};
  const roster = liveRoster({
    match: {
      players: (Array.isArray(match?.players) ? match.players : []).filter(
        (player) =>
          player && playerId(player.id) && [0, 1].includes(player.team),
      ),
    },
    settings: current?.settings,
  });
  return {
    enabled: settings.enabled,
    layout: settings.layout,
    source,
    teams: [0, 1].map((team) => {
      const players = roster
        .filter((player) => player.team === team)
        .slice(0, 6);
      return Array.from({ length: 6 }, (_, slot) => {
        const player = players[slot];
        if (!player)
          return {
            id: `manual-${team}-${slot}`,
            name: settings.manual[team][slot],
            heroId: null,
            sourceName: "",
            manual: true,
          };
        const sourceName = string(names[player.id] || player.name, "", 48);
        const manual = own(settings.overrides, player.id);
        return {
          id: player.id,
          name: manual ? settings.overrides[player.id] : sourceName,
          heroId: heroId(player.heroId),
          sourceName,
          manual,
        };
      });
    }),
  };
}

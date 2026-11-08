import { safeImage } from "./draft.js";
import { cleanBracket } from "./bracket.js";
import { teamLogo } from "./team-identity.js";

const text = (value, limit = 80) =>
  typeof value === "string" ? value.trim().slice(0, limit) : "";
const identifier = (value) =>
  typeof value === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(value)
    ? value
    : "";
const score = (value) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(99, Math.floor(value)))
    : 0;

// This URL is an operator's external OBS source, never a server fetch or iframe.
export function discordVoiceUrl(value) {
  if (typeof value !== "string" || value.length > 3000) return "";
  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== "https:" ||
      url.hostname !== "streamkit.discord.com" ||
      url.port ||
      url.username ||
      url.password ||
      url.hash ||
      !/^\/overlay\/voice(?:\/\d{10,25}\/\d{10,25})?\/?$/.test(url.pathname)
    )
      return "";
    return url.href;
  } catch {
    return "";
  }
}

export function cleanCasterStage(value = {}) {
  return {
    visible: value?.visible !== false,
    transparent: value?.transparent === true,
    title: text(value?.title) || "The caster desk",
    subtitle: text(value?.subtitle, 120),
    layout: ["avatars", "webcams", "discord"].includes(value?.layout)
      ? value.layout
      : "avatars",
    source: ["broadcast", "bracket", "manual"].includes(value?.source)
      ? value.source
      : "broadcast",
    matchId: identifier(value?.matchId),
    teams: [0, 1].map((side) => ({
      name: text(value?.teams?.[side]?.name),
      logo: safeImage(value?.teams?.[side]?.logo),
      score: score(value?.teams?.[side]?.score),
    })),
    casterCount: [1, 2, 3, 4].includes(value?.casterCount)
      ? value.casterCount
      : 2,
    casters: Array.from({ length: 4 }, (_, index) => ({
      name: text(value?.casters?.[index]?.name, 48),
      role: text(value?.casters?.[index]?.role, 48),
      avatar: safeImage(value?.casters?.[index]?.avatar),
    })),
    discordUrl: discordVoiceUrl(value?.discordUrl),
  };
}

export function casterSlots(count = 2) {
  const total = [1, 2, 3, 4].includes(count) ? count : 2;
  const gap = 32;
  const width = Math.min(704, (1664 - gap * (total - 1)) / total);
  const left = (1920 - (width * total + gap * (total - 1))) / 2;
  return Array.from({ length: total }, (_, index) => ({
    x: left + index * (width + gap),
    y: 270,
    width,
    height: 396,
  }));
}

export function casterStageOutput(workspace = {}) {
  const settings = cleanCasterStage(workspace.casterStage);
  let teams = settings.teams;
  let round = "";
  let format = "";
  if (settings.source === "broadcast") {
    teams = [0, 1].map((side) => {
      const configured = workspace.config?.teams?.[side] || {};
      const source = workspace.draft?.snapshot?.teams?.find(
        (team) => Number(team.teamNumber) === side + 1,
      );
      return {
        name: text(
          workspace.config?.useSourceNames && source?.displayName
            ? source.displayName
            : configured.name,
        ),
        logo: safeImage(
          configured.logo ||
            (workspace.config?.useSourceNames ? source?.teamLogo : ""),
        ),
        score: score(configured.score),
      };
    });
    round = text(workspace.config?.round);
    format = text(workspace.config?.format, 8);
  } else if (settings.source === "bracket") {
    const bracket = cleanBracket(workspace.bracket);
    const match = bracket.matches.find((item) => item.id === settings.matchId);
    teams = [0, 1].map((side) => {
      const entrant =
        match?.required && match.status !== "bye"
          ? bracket.entrants.find((item) => item.id === match.teamIds[side])
          : null;
      return {
        name: text(entrant?.name),
        logo: safeImage(entrant?.logo),
        score:
          entrant && match.status !== "waiting"
            ? score(match.scores[side])
            : null,
      };
    });
    if (match?.required && match.status !== "bye") {
      round = `Round ${match.round + 1}`;
      format = text(match.seriesFormat, 8);
    }
  }
  // Discord source URLs and roster account details stay in the admin workspace.
  return {
    visible: settings.visible,
    transparent: settings.transparent,
    title: settings.title,
    subtitle: settings.subtitle,
    layout: settings.layout,
    event: text(workspace.config?.event),
    round,
    format,
    teams: teams.map((team) => ({
      name: team.name || "To be decided",
      resolved: Boolean(team.name),
      logo: team.name ? teamLogo(team.logo) : "",
      score: team.name ? team.score : null,
    })),
    casters: settings.casters.slice(0, settings.casterCount),
  };
}

import { safeImage } from "./draft.js";

const formats = ["BO1", "BO3", "BO5", "BO7"];
const methods = ["seeded", "random", "manual"];
const text = (value, maximum = 80) =>
  typeof value === "string" ? value.slice(0, maximum) : "";
const identifier = (value) =>
  typeof value === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(value)
    ? value
    : "";
const integer = (value, maximum = 99) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(maximum, Math.floor(value)))
    : 0;
const samePair = (first, second) =>
  Array.isArray(first) && first[0] === second[0] && first[1] === second[1];

export function winsRequired(format) {
  return { BO1: 1, BO3: 2, BO5: 3, BO7: 4 }[format] || 2;
}

const roundKey = (round) =>
  Number.isInteger(round) && round >= 0 && round < 5
    ? `r${round + 1}`
    : typeof round === "string" && /^r[1-5]$/.test(round)
      ? round
      : "";

function cleanRoundFormats(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      ([key, format]) => roundKey(key) && formats.includes(format),
    ),
  );
}

export function bracketRoundFormat(state, round) {
  const override = state?.roundFormats?.[roundKey(round)];
  return formats.includes(override)
    ? override
    : formats.includes(state?.seriesFormat)
      ? state.seriesFormat
      : "BO3";
}

function entrant(value) {
  const team = value && typeof value === "object" ? value : {};
  return {
    id: identifier(team.id),
    name: text(team.name, 80).trim(),
    tag: text(team.tag, 8),
    logo: safeImage(team.logo),
    players: (Array.isArray(team.players) ? team.players : [])
      .slice(0, 6)
      .map((player) => ({
        id: identifier(player?.id),
        name: text(player?.name, 48),
        steamId:
          typeof player?.steamId === "string" &&
          /^\d{1,20}$/.test(player.steamId)
            ? player.steamId
            : "",
      })),
  };
}

function entrantsOf(value) {
  const identities = new Set();
  const names = new Set();
  return (Array.isArray(value) ? value : [])
    .slice(0, 32)
    .map(entrant)
    .filter((team) => {
      const name = team.name.toLocaleLowerCase();
      if (!team.id || !name || identities.has(team.id) || names.has(name))
        return false;
      identities.add(team.id);
      names.add(name);
      return true;
    });
}

function propagate(state, previous = []) {
  const saved = new Map(
    (Array.isArray(previous) ? previous : []).map((match) => [
      match?.id,
      match,
    ]),
  );
  const result = [];
  let previousRound = [];
  for (
    let round = 0, count = state.slots.length / 2;
    count >= 1;
    round++, count /= 2
  ) {
    const current = [];
    for (let index = 0; index < count; index++) {
      const upstream = round
        ? [previousRound[index * 2], previousRound[index * 2 + 1]]
        : null;
      const ready =
        !upstream ||
        upstream.every((match) => ["complete", "bye"].includes(match.status));
      const teamIds = upstream
        ? upstream.map((match) => match.winnerId)
        : state.slots.slice(index * 2, index * 2 + 2);
      const id = `r${round + 1}-m${index + 1}`;
      const old = saved.get(id);
      const valid = ready && samePair(old?.teamIds, teamIds);
      const seriesFormat = bracketRoundFormat(state, round);
      const needed = winsRequired(seriesFormat);
      let scores = valid
        ? [integer(old.scores?.[0], needed), integer(old.scores?.[1], needed)]
        : [0, 0];
      if (scores[0] === needed && scores[1] === needed) scores = [0, 0];
      const present = teamIds.filter(Boolean);
      let status = !ready ? "waiting" : present.length === 2 ? "ready" : "bye";
      let winnerId = status === "bye" ? present[0] || null : null;
      if (status === "ready") {
        const winning = scores.findIndex((score) => score === needed);
        if (winning !== -1) {
          winnerId = teamIds[winning];
          status = "complete";
        }
      } else scores = [0, 0];
      const games =
        valid && present.length === 2
          ? (Array.isArray(old.games) ? old.games : [])
              .filter(
                (game) =>
                  identifier(game?.gameId) && teamIds.includes(game?.winnerId),
              )
              .slice(-64)
              .map((game) => ({
                gameId: identifier(game.gameId),
                winnerId: game.winnerId,
              }))
          : [];
      const match = {
        id,
        round,
        index,
        seriesFormat,
        required: matchHasOpponents(state.slots, round, index),
        teamIds,
        scores,
        winnerId,
        status,
        games,
      };
      result.push(match);
      current.push(match);
    }
    previousRound = current;
  }
  return result;
}

export function cleanBracket(value = {}) {
  if (!value || typeof value !== "object") value = {};
  const entrants = entrantsOf(value.entrants);
  const identities = new Set(entrants.map((team) => team.id));
  const originalSlots = Array.isArray(value.slots) ? value.slots : [];
  const size = originalSlots.length;
  const used = new Set();
  const slots =
    size >= 2 && size <= 32 && (size & (size - 1)) === 0
      ? originalSlots.map((id) => {
          if (!identities.has(id) || used.has(id)) return null;
          used.add(id);
          return id;
        })
      : [];
  const state = {
    version: 1,
    revision: integer(value.revision, Number.MAX_SAFE_INTEGER),
    format: "single",
    seriesFormat: formats.includes(value.seriesFormat)
      ? value.seriesFormat
      : "BO3",
    roundFormats: cleanRoundFormats(value.roundFormats),
    seeding: methods.includes(value.seeding) ? value.seeding : "seeded",
    entrants,
    slots,
    matches: [],
    activeMatchId: identifier(value.activeMatchId),
    visible: value.visible !== false,
    transparent: value.transparent === true,
    autoResults: value.autoResults !== false,
    lastSync:
      value.lastSync && typeof value.lastSync === "object"
        ? {
            message: text(value.lastSync.message, 240),
            gameId: identifier(value.lastSync.gameId),
          }
        : null,
    processedGameIds: [
      ...new Set(
        (Array.isArray(value.processedGameIds) ? value.processedGameIds : [])
          .map(identifier)
          .filter(Boolean),
      ),
    ].slice(-512),
  };
  state.matches = propagate(state, value.matches);
  if (
    !state.matches.some(
      (match) =>
        match.id === state.activeMatchId &&
        ["ready", "complete"].includes(match.status),
    )
  )
    state.activeMatchId = "";
  return state;
}

function seedPositions(size) {
  let positions = [1, 2];
  while (positions.length < size) {
    const total = positions.length * 2 + 1;
    positions = positions.flatMap((seed) => [seed, total - seed]);
  }
  return positions;
}

export function generateBracket(teams, options = {}) {
  if (!Array.isArray(teams) || teams.length < 2 || teams.length > 32)
    throw Error("Add between 2 and 32 teams before generating a bracket.");
  const entrants = entrantsOf(teams);
  if (entrants.length !== teams.length)
    throw Error("Each team needs a unique ID and a different team name.");
  const seeding = methods.includes(options.seeding)
    ? options.seeding
    : "seeded";
  const seriesFormat = formats.includes(options.seriesFormat)
    ? options.seriesFormat
    : "BO3";
  const order = [...entrants];
  if (seeding === "random") {
    const random =
      typeof options.random === "function" ? options.random : Math.random;
    for (let index = order.length - 1; index > 0; index--) {
      const sample = random();
      if (!Number.isFinite(sample) || sample < 0 || sample >= 1)
        throw Error("Could not generate a random bracket. Try again.");
      const swap = Math.floor(sample * (index + 1));
      [order[index], order[swap]] = [order[swap], order[index]];
    }
  }
  const size = 2 ** Math.ceil(Math.log2(order.length));
  const positions =
    seeding === "manual"
      ? Array.from({ length: size }, (_, index) => index + 1)
      : seedPositions(size);
  return cleanBracket({
    ...options,
    entrants,
    seriesFormat,
    seeding,
    slots: positions.map((seed) => order[seed - 1]?.id || null),
    matches: [],
    processedGameIds: [],
    activeMatchId: "",
    lastSync: null,
  });
}

export function bracketMatch(state, id) {
  return cleanBracket(state).matches.find((match) => match.id === id) || null;
}

function matchHasOpponents(slots, round, index) {
  const half = 2 ** round;
  const start = index * half * 2;
  return (
    slots.slice(start, start + half).some(Boolean) &&
    slots.slice(start + half, start + half * 2).some(Boolean)
  );
}

export function bracketMatchRequired(state, id) {
  return bracketMatch(state, id)?.required === true;
}

export function setBracketFormats(value, roundFormats) {
  if (
    !roundFormats ||
    typeof roundFormats !== "object" ||
    Array.isArray(roundFormats) ||
    Object.entries(roundFormats).some(
      ([key, format]) => !roundKey(key) || !formats.includes(format),
    )
  )
    throw Error("Choose BO1, BO3, BO5 or BO7 for each bracket round.");
  const state = cleanBracket(value);
  const next = { ...state, roundFormats: cleanRoundFormats(roundFormats) };
  for (const match of state.matches) {
    const changed =
      bracketRoundFormat(state, match.round) !==
      bracketRoundFormat(next, match.round);
    if (
      changed &&
      match.status !== "bye" &&
      (match.scores.some(Boolean) ||
        match.games.length ||
        match.status === "complete")
    )
      throw Error(
        "This round already has results. Clear its results before changing its match format.",
      );
  }
  return cleanBracket(next);
}

function readyMatch(state, id) {
  const match = state.matches.find((item) => item.id === id);
  if (!match) throw Error("Bracket match not found.");
  if (
    !match.teamIds.every(Boolean) ||
    !["ready", "complete"].includes(match.status)
  )
    throw Error("Both teams must be known before setting a match result.");
  return match;
}

export function setBracketResult(value, matchId, result = {}) {
  const state = cleanBracket(value);
  const match = readyMatch(state, matchId);
  if (result.clear) {
    match.scores = [0, 0];
    match.winnerId = null;
    match.games = [];
    return cleanBracket(state);
  }
  const needed = winsRequired(match.seriesFormat);
  const hasWinner = Object.hasOwn(result, "winnerId");
  const winnerId = hasWinner ? result.winnerId : null;
  if (winnerId !== null && !match.teamIds.includes(winnerId))
    throw Error("Choose one of this match's teams as its winner.");
  let scores;
  if (result.scores !== undefined) {
    if (
      !Array.isArray(result.scores) ||
      result.scores.length !== 2 ||
      result.scores.some(
        (score) => !Number.isInteger(score) || score < 0 || score > needed,
      )
    )
      throw Error(`Enter scores from 0 to ${needed} for this series format.`);
    scores = [...result.scores];
  } else if (winnerId) {
    scores = match.teamIds.map((id) => (id === winnerId ? needed : 0));
  } else scores = [0, 0];
  const winning = scores.findIndex((score) => score === needed);
  if (
    scores.every((score) => score === needed) ||
    (winnerId && match.teamIds[winning] !== winnerId)
  )
    throw Error("The winning team and series scores do not agree.");
  if (hasWinner && winnerId === null && winning !== -1)
    throw Error("A completed series needs its winning team.");
  match.scores = scores;
  match.winnerId = winning === -1 ? null : match.teamIds[winning];
  return cleanBracket(state);
}

export function recordBracketGame(
  value,
  { matchId, gameId, winnerId, rehearsal = false } = {},
) {
  const state = cleanBracket(value);
  if (rehearsal || state.autoResults === false) return state;
  if (!identifier(gameId))
    throw Error("A saved game ID is required to update the bracket.");
  if (state.processedGameIds.includes(gameId)) return state;
  const match = readyMatch(state, matchId);
  if (match.status === "complete")
    throw Error("This bracket series is already complete.");
  const side = match.teamIds.indexOf(winnerId);
  if (side === -1)
    throw Error("The published winner is not a team in this bracket match.");
  match.scores[side]++;
  match.games.push({ gameId, winnerId });
  state.processedGameIds.push(gameId);
  state.lastSync = {
    gameId,
    message: "Published game result added to the bracket.",
  };
  return cleanBracket(state);
}

function roundName(round, total) {
  const remaining = total - round;
  if (remaining === 1) return "Final";
  if (remaining === 2) return "Semifinals";
  if (remaining === 3) return "Quarterfinals";
  return `Round of ${2 ** remaining}`;
}

export function bracketOutput(value, { title = "Tournament bracket" } = {}) {
  const state = cleanBracket(value);
  const teams = new Map(
    state.entrants.map(({ id, name, tag, logo }) => [
      id,
      { id, name, tag, logo },
    ]),
  );
  const count = state.slots.length ? Math.log2(state.slots.length) : 0;
  const rounds = Array.from({ length: count }, (_, round) => ({
    id: `r${round + 1}`,
    name: roundName(round, count),
    seriesFormat: bracketRoundFormat(state, round),
    matches: state.matches
      .filter((match) => match.round === round)
      .map((match) => ({
        id: match.id,
        seriesFormat: match.seriesFormat,
        required: match.required,
        teams: match.teamIds.map((id) => teams.get(id) || null),
        scores: match.scores,
        winnerId: match.winnerId,
        status: match.status,
        bye: match.status === "bye",
      })),
  }));
  const final = state.matches.at(-1);
  return {
    title: text(title, 120),
    format: state.format,
    seriesFormat: state.seriesFormat,
    visible: state.visible,
    transparent: state.transparent,
    activeMatchId: state.activeMatchId,
    rounds,
    champion: final?.winnerId ? teams.get(final.winnerId) || null : null,
  };
}

export const publicBracket = bracketOutput;

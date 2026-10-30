import { randomUUID, randomInt } from "node:crypto";
import { safeImage } from "../src/draft.js";
import {
  cleanBracket,
  generateBracket,
  setBracketResult,
  recordBracketGame,
  bracketMatch,
} from "../src/bracket.js";
import { normalizeSteamId } from "./roster-library.mjs";

const uuid = (value) =>
  typeof value === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const text = (value, max = 80) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";
const id = (value) => {
  if (value === undefined || value === null || value === "")
    return randomUUID();
  if (!uuid(value)) throw Error("Invalid team or player reference.");
  return value.toLowerCase();
};
const label = (value) => text(value).toLocaleLowerCase();
const fail = (message, status = 400) => {
  throw Object.assign(Error(message), { status });
};
const played = (bracket) =>
  bracket.matches.some(
    (match) =>
      match.games.length ||
      match.scores.some(Boolean) ||
      match.status === "complete",
  );

export function prepareTournamentBracket(options = {}, library) {
  const input = options.entrants ?? [];
  if (!Array.isArray(input) || input.length > 32)
    throw Error("A bracket can contain up to 32 teams.");
  const teamIds = new Set(),
    teamNames = new Set(),
    steamIds = new Set(),
    usedPlayerIds = new Set();
  const entrants = input.map((raw) => {
    if (!raw || typeof raw !== "object")
      throw Error("Invalid tournament team.");
    const name = text(raw.name);
    if (!name) throw Error("Enter a name for every tournament team.");
    const teamId = id(raw.id);
    if (teamIds.has(teamId) || teamNames.has(label(name)))
      throw Error("Each tournament team needs a unique name and reference.");
    teamIds.add(teamId);
    teamNames.add(label(name));
    if (
      raw.players !== undefined &&
      (!Array.isArray(raw.players) || raw.players.length > 6)
    )
      throw Error("Each team can have up to six players.");
    const players = (raw.players || []).flatMap((player) => {
      if (!player || typeof player !== "object")
        throw Error("Invalid player details.");
      const playerName = text(player.name, 48);
      const steamId = normalizeSteamId(player.steamId);
      if (!playerName && !steamId) return [];
      if (!playerName)
        throw Error("Add a player name beside each Steam account.");
      const playerId = id(player.id);
      if (usedPlayerIds.has(playerId) || (steamId && steamIds.has(steamId)))
        throw Error("A player can appear only once in the tournament roster.");
      usedPlayerIds.add(playerId);
      if (steamId) steamIds.add(steamId);
      return [{ id: playerId, name: playerName, steamId }];
    });
    return {
      id: teamId,
      name,
      tag: text(raw.tag, 8),
      logo: safeImage(raw.logo),
      players,
    };
  });
  const settings = {
    ...cleanBracket(options),
    entrants,
    seeding: options.seeding || "seeded",
    seriesFormat: options.seriesFormat || "BO3",
  };
  const bracket =
    options.generate && entrants.length >= 2
      ? generateBracket(entrants, {
          ...settings,
          random: () => randomInt(0, 2 ** 32) / 2 ** 32,
        })
      : cleanBracket(settings);
  if (options.saveToLibrary === true) {
    if (!library) throw Error("The saved roster library is unavailable.");
    library.transaction(() => {
      for (const team of entrants) {
        const playerIds = team.players.map(
          (player) =>
            library.savePlayer({
              ...(library.getPlayer(player.id) ? { id: player.id } : {}),
              name: player.name,
              steamId: player.steamId,
            }).id,
        );
        library.saveTeam({
          ...(library.getTeam(team.id) ? { id: team.id } : {}),
          name: team.name,
          tag: team.tag,
          logo: team.logo,
          playerIds,
          updateExisting: true,
        });
      }
    });
  }
  return bracket;
}

export class BracketService {
  constructor(store) {
    this.store = store;
  }

  assertRevision(value) {
    if (
      !Number.isInteger(value.expectedRevision) ||
      value.expectedRevision !==
        cleanBracket(this.store.workspace.bracket).revision
    )
      fail(
        "Another admin changed this bracket. Review the refreshed bracket before trying again.",
        409,
      );
  }

  mirrorScores(bracket, config) {
    const match = bracketMatch(bracket, bracket.activeMatchId);
    if (!match || match.teamIds.some((teamId) => !teamId)) return;
    const names = match.teamIds.map((teamId) =>
      label(bracket.entrants.find((team) => team.id === teamId)?.name),
    );
    const sides = config.teams.map((team) => names.indexOf(label(team.name)));
    if (sides.some((side) => side < 0) || new Set(sides).size !== 2) return;
    config.teams.forEach((team, index) => {
      team.score = match.scores[sides[index]];
    });
    config.game = match.scores[0] + match.scores[1] + 1;
  }

  commit(next, changeConfig, persist) {
    const store = this.store,
      workspace = store.workspace;
    const previous = structuredClone(workspace);
    const record = store.tournaments?.records.get(workspace.activeTournamentId);
    const previousRecord = record ? structuredClone(record.state) : null;
    return store.rosterLibrary.transaction(() => {
      try {
        next.revision = cleanBracket(workspace.bracket).revision + 1;
        workspace.bracket = next;
        if (changeConfig) changeConfig(workspace.config);
        workspace.revision++;
        store.saveWorkspace();
        if (persist) persist();
        return workspace;
      } catch (error) {
        workspace.bracket = previous.bracket;
        Object.assign(workspace.config, previous.config);
        workspace.revision = previous.revision;
        if (record) record.state = previousRecord;
        throw error;
      }
    });
  }

  command(action, value = {}) {
    this.assertRevision(value);
    const store = this.store;
    const current = cleanBracket(store.workspace.bracket);
    if (action === "settings") {
      const next = { ...current };
      for (const key of ["visible", "transparent", "autoResults"])
        if (typeof value[key] === "boolean") next[key] = value[key];
      return this.commit(next);
    }
    if (action === "entrants" || action === "generate") {
      if (played(current) && value.resetConfirmed !== true)
        fail(
          "This bracket already has results. Confirm replacement to reset those results.",
          409,
        );
      return store.rosterLibrary.transaction(() => {
        const next = prepareTournamentBracket(
          {
            ...current,
            ...value,
            entrants: action === "generate" ? current.entrants : value.entrants,
            generate: action === "generate" || value.generate === true,
            matches: [],
            slots: [],
            activeMatchId: "",
            processedGameIds: [],
            lastSync: null,
          },
          store.rosterLibrary,
        );
        return this.commit(next);
      });
    }
    if (action === "result" || action === "clear-result") {
      const next = setBracketResult(
        current,
        value.matchId,
        action === "clear-result" ? { clear: true } : value,
      );
      return this.commit(next, (config) => this.mirrorScores(next, config));
    }
    if (action === "prepare") {
      store.tournaments?.assertIdle();
      const match = bracketMatch(current, value.matchId);
      if (
        !match ||
        match.status !== "ready" ||
        match.teamIds.some((teamId) => !teamId)
      )
        throw Error("Choose a ready match with two teams.");
      const teams = match.teamIds.map((teamId) =>
        current.entrants.find((team) => team.id === teamId),
      );
      const next = { ...current, activeMatchId: match.id, lastSync: null };
      return this.commit(next, (config) => {
        config.teams = teams.map((team, index) => ({
          ...config.teams[index],
          name: team.name,
          tag: team.tag,
          logo: team.logo,
          score: match.scores[index],
        }));
        config.format = current.seriesFormat;
        config.useSourceNames = false;
        config.game = match.scores[0] + match.scores[1] + 1;
      });
    }
    throw Error("Unknown bracket command.");
  }

  onPublished(session, sourceTeams = session?.published?.teams) {
    const store = this.store;
    const current = cleanBracket(store.workspace.bracket);
    const published = session?.published;
    if (
      !current.autoResults ||
      !published ||
      !session.result ||
      [session.mode, session.result.captureMode, published.captureMode].some(
        (mode) => ["rehearsal", "replay"].includes(mode),
      ) ||
      (store.workspace.activeTournamentId &&
        session.tournamentId !== store.workspace.activeTournamentId)
    )
      return false;
    const gameId = String(
      session.result.match?.matchId ||
        published.match?.matchId ||
        session.id ||
        "",
    );
    if (!gameId) return false;
    const awarded =
      session.bracketAward ||
      [...store.sessions.values()].find(
        (saved) => saved.bracketAward?.gameId === gameId,
      )?.bracketAward;
    if (awarded) {
      const winningName =
        Array.isArray(sourceTeams) && [0, 1].includes(published.winner)
          ? label(sourceTeams[published.winner]?.name)
          : "";
      const winner = current.entrants.find(
        (team) => label(team.name) === winningName,
      );
      if (winner && winner.id !== awarded.winnerId) {
        const message = `This game was already applied to ${awarded.matchId}. Correct its bracket result manually.`;
        if (
          current.lastSync?.gameId !== gameId ||
          current.lastSync?.message !== message
        )
          this.commit({ ...current, lastSync: { gameId, message } });
      }
      return false;
    }
    if (!current.activeMatchId || current.processedGameIds.includes(gameId))
      return false;
    const match = bracketMatch(current, current.activeMatchId);
    if (
      !match ||
      match.status !== "ready" ||
      match.teamIds.some((teamId) => !teamId)
    )
      return false;
    const teams = match.teamIds.map((teamId) =>
      current.entrants.find((team) => team.id === teamId),
    );
    const incoming = (Array.isArray(sourceTeams) ? sourceTeams : []).map(
      (team) => label(team?.name),
    );
    const sides = incoming.map((name) =>
      teams.findIndex((team) => label(team.name) === name),
    );
    if (
      incoming.length !== 2 ||
      sides.some((side) => side < 0) ||
      new Set(sides).size !== 2 ||
      ![0, 1].includes(published.winner)
    ) {
      const message =
        "Published team names do not match the prepared bracket match. Review the match or enter its result manually.";
      if (
        current.lastSync?.gameId === gameId &&
        current.lastSync?.message === message
      )
        return false;
      this.commit({
        ...current,
        lastSync: {
          gameId,
          message,
        },
      });
      return false;
    }
    const winnerId = teams[sides[published.winner]].id;
    const next = recordBracketGame(current, {
      matchId: match.id,
      gameId,
      winnerId,
    });
    if (JSON.stringify(next) === JSON.stringify(current)) return false;
    const previousAward = session.bracketAward;
    try {
      session.bracketAward = {
        tournamentId: store.workspace.activeTournamentId,
        matchId: match.id,
        gameId,
        winnerId,
        at: Date.now(),
      };
      const result = this.commit(
        next,
        (config) => this.mirrorScores(next, config),
        () =>
          store.db
            .prepare("INSERT OR REPLACE INTO matches VALUES (?,?)")
            .run(session.id, JSON.stringify(session)),
      );
      return Boolean(result);
    } catch (error) {
      if (previousAward) session.bracketAward = previousAward;
      else delete session.bracketAward;
      throw error;
    }
  }
}

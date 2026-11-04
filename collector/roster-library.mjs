import { randomUUID } from "node:crypto";
import { safeImage } from "../src/draft.js";

const STEAM_BASE = 76561197960265728n;
const MAX_ACCOUNT = 4294967295n;
const MAX_PLAYERS = 10000;
const MAX_TEAMS = 2000;
const identifier = (value) =>
  typeof value === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const idOf = (value) => {
  if (!identifier(value)) throw Error("Invalid saved roster ID.");
  return value.toLowerCase();
};
const text = (value, maximum = 80) =>
  typeof value === "string" ? value.trim().slice(0, maximum) : "";
const nameOf = (value, kind) => {
  const name = text(value);
  if (!name) throw Error(`Enter a ${kind} name.`);
  return name;
};
const stamp = (value) =>
  Number.isFinite(value) && value > 0 ? value : Date.now();

// No profile request is needed to normalize a public numeric Steam profile.
// Keep the 64-bit identifier as a string; JS numbers lose precision here.
export function normalizeSteamId(value = "") {
  if (value === null || value === undefined || value === "") return "";
  if (
    typeof value !== "string" &&
    !(typeof value === "number" && Number.isSafeInteger(value))
  )
    throw Error(
      "Paste a SteamID64, numeric account ID, or numeric Steam profile URL.",
    );
  let input = String(value).trim();
  if (!input) return "";
  if (/^https?:\/\//i.test(input)) {
    let url;
    try {
      url = new URL(input);
    } catch {
      throw Error("Enter a valid numeric Steam profile URL.");
    }
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
      throw Error(
        "Use a numeric steamcommunity.com/profiles/SteamID64 URL; vanity profile names are not supported yet.",
      );
    input = match[1];
  }
  if (!/^\d{1,20}$/.test(input))
    throw Error(
      "Paste a SteamID64, numeric account ID, or numeric Steam profile URL.",
    );
  const number = BigInt(input);
  if (number > 0n && number <= MAX_ACCOUNT) return String(STEAM_BASE + number);
  if (number > STEAM_BASE && number <= STEAM_BASE + MAX_ACCOUNT)
    return String(number);
  throw Error("This is not a valid individual Steam account ID.");
}

function cleanPlayer(value) {
  if (!value || typeof value !== "object") throw Error("Invalid saved player.");
  return {
    id: idOf(value.id),
    name: nameOf(value.name, "player"),
    steamId: normalizeSteamId(value.steamId),
    createdAt: stamp(value.createdAt),
    updatedAt: stamp(value.updatedAt),
  };
}

function cleanTeam(value) {
  if (!value || typeof value !== "object") throw Error("Invalid saved team.");
  if (!Array.isArray(value.playerIds) || value.playerIds.length > 6)
    throw Error("A saved team can have up to six players.");
  const playerIds = value.playerIds.map(idOf);
  if (new Set(playerIds).size !== playerIds.length)
    throw Error("A player cannot occupy two positions on the same team.");
  return {
    id: idOf(value.id),
    name: nameOf(value.name, "team"),
    tag: text(value.tag, 16),
    logo: safeImage(value.logo),
    playerIds,
    createdAt: stamp(value.createdAt),
    updatedAt: stamp(value.updatedAt),
  };
}

export function cleanRosterSnapshot(value) {
  if (value === null || value === undefined)
    return { version: 1, players: [], teams: [] };
  if (
    value?.version !== 1 ||
    !Array.isArray(value.players) ||
    !Array.isArray(value.teams) ||
    value.players.length > MAX_PLAYERS ||
    value.teams.length > MAX_TEAMS
  )
    throw Error("Invalid saved teams and players in backup.");
  const players = value.players.map(cleanPlayer);
  const teams = value.teams.map(cleanTeam);
  const playerIds = new Set(players.map((player) => player.id));
  if (
    playerIds.size !== players.length ||
    new Set(teams.map((team) => team.id)).size !== teams.length
  )
    throw Error("Saved roster records contain duplicate IDs.");
  for (const team of teams)
    if (team.playerIds.some((id) => !playerIds.has(id)))
      throw Error("A saved team references an unknown player.");
  return { version: 1, players, teams };
}

export class RosterLibrary {
  constructor(store) {
    this.store = store;
    this.transactionId = 0;
    store.db.exec(`
      CREATE TABLE IF NOT EXISTS roster_players (
        id TEXT PRIMARY KEY, steamId TEXT UNIQUE, value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS roster_teams (
        id TEXT PRIMARY KEY, nameKey TEXT UNIQUE NOT NULL, value TEXT NOT NULL
      );
    `);
  }

  transaction(callback) {
    const name = `roster_library_${++this.transactionId}`;
    this.store.db.exec(`SAVEPOINT ${name}`);
    try {
      const result = callback();
      this.store.db.exec(`RELEASE SAVEPOINT ${name}`);
      return result;
    } catch (error) {
      this.store.db.exec(`ROLLBACK TO SAVEPOINT ${name}`);
      this.store.db.exec(`RELEASE SAVEPOINT ${name}`);
      throw error;
    }
  }

  rows(table) {
    return this.store.db
      .prepare(`SELECT value FROM ${table} ORDER BY rowid`)
      .all()
      .map((row) => JSON.parse(row.value));
  }

  count(table) {
    return this.store.db.prepare(`SELECT count(*) AS total FROM ${table}`).get()
      .total;
  }

  getPlayer(id) {
    const row = this.store.db
      .prepare("SELECT value FROM roster_players WHERE id=?")
      .get(idOf(id));
    return row ? JSON.parse(row.value) : null;
  }

  getTeam(id) {
    const row = this.store.db
      .prepare("SELECT value FROM roster_teams WHERE id=?")
      .get(idOf(id));
    return row ? JSON.parse(row.value) : null;
  }

  resolveTeam(id) {
    const team = this.getTeam(id);
    return team
      ? {
          ...team,
          players: team.playerIds.map((playerId) => this.getPlayer(playerId)),
        }
      : null;
  }

  list(options = {}) {
    const query = text(
      typeof options === "string" ? options : options.query,
      100,
    ).toLowerCase();
    const allPlayers = this.rows("roster_players");
    const playerMatches = new Set(
      allPlayers
        .filter((player) =>
          `${player.name} ${player.steamId}`.toLowerCase().includes(query),
        )
        .map((player) => player.id),
    );
    return {
      players: allPlayers
        .filter((player) => playerMatches.has(player.id))
        .sort((a, b) => a.name.localeCompare(b.name)),
      teams: this.rows("roster_teams")
        .filter(
          (team) =>
            `${team.name} ${team.tag}`.toLowerCase().includes(query) ||
            team.playerIds.some((id) => playerMatches.has(id)),
        )
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  savePlayer(value) {
    return this.transaction(() => this.putPlayer(value));
  }

  putPlayer(value) {
    if (!value || typeof value !== "object")
      throw Error("Invalid player details.");
    const explicit = value.id ? this.getPlayer(value.id) : null;
    if (value.id && !explicit) throw Error("Saved player not found.");
    const steamId = normalizeSteamId(value.steamId ?? explicit?.steamId);
    const row = steamId
      ? this.store.db
          .prepare("SELECT value FROM roster_players WHERE steamId=?")
          .get(steamId)
      : null;
    const matching = row ? JSON.parse(row.value) : null;
    if (matching && explicit && matching.id !== explicit.id)
      throw Error(
        "That Steam account is already saved for another player. Select the existing player instead.",
      );
    // Selecting an existing Steam account must not silently rename its record.
    if (matching && !explicit && value.updateExisting !== true) return matching;
    const previous = explicit || matching;
    const player = cleanPlayer({
      id: previous?.id || randomUUID(),
      name: value.name ?? previous?.name,
      steamId,
      createdAt: previous?.createdAt || Date.now(),
      updatedAt: Date.now(),
    });
    if (!previous && this.count("roster_players") >= MAX_PLAYERS)
      throw Error("The saved player library is full.");
    this.store.db
      .prepare("INSERT OR REPLACE INTO roster_players VALUES (?,?,?)")
      .run(player.id, player.steamId || null, JSON.stringify(player));
    return player;
  }

  saveTeam(value) {
    return this.transaction(() => {
      if (!value || typeof value !== "object")
        throw Error("Invalid team details.");
      const explicit = value.id ? this.getTeam(value.id) : null;
      if (value.id && !explicit) throw Error("Saved team not found.");
      const name = nameOf(value.name ?? explicit?.name, "team");
      const row = this.store.db
        .prepare("SELECT value FROM roster_teams WHERE nameKey=?")
        .get(name.toLowerCase());
      const matching = row ? JSON.parse(row.value) : null;
      if (explicit && matching && explicit.id !== matching.id)
        throw Error("Another saved team already uses this name.");
      if (matching && !explicit && value.updateExisting !== true)
        return matching;
      const previous = explicit || matching;
      let playerIds = value.playerIds ?? previous?.playerIds ?? [];
      if (value.players !== undefined) {
        if (value.savePlayers !== true)
          throw Error(
            "Choose to save the players before adding them to a saved team.",
          );
        if (!Array.isArray(value.players) || value.players.length > 6)
          throw Error("A saved team can have up to six players.");
        playerIds = value.players.map((player) => this.putPlayer(player).id);
      }
      const team = cleanTeam({
        id: previous?.id || randomUUID(),
        name,
        tag: value.tag ?? previous?.tag,
        logo: value.logo ?? previous?.logo,
        playerIds,
        createdAt: previous?.createdAt || Date.now(),
        updatedAt: Date.now(),
      });
      if (team.playerIds.some((id) => !this.getPlayer(id)))
        throw Error("Choose saved players for every team position.");
      if (!previous && this.count("roster_teams") >= MAX_TEAMS)
        throw Error("The saved team library is full.");
      this.store.db
        .prepare("INSERT OR REPLACE INTO roster_teams VALUES (?,?,?)")
        .run(team.id, team.name.toLowerCase(), JSON.stringify(team));
      return team;
    });
  }

  snapshot() {
    return {
      version: 1,
      players: this.rows("roster_players"),
      teams: this.rows("roster_teams"),
    };
  }

  prepareRestore(value) {
    return cleanRosterSnapshot(value);
  }

  restore(value) {
    const incoming = this.prepareRestore(value);
    return this.transaction(() => {
      const remap = new Map();
      for (const player of incoming.players) {
        const byId = this.getPlayer(player.id);
        const row = player.steamId
          ? this.store.db
              .prepare("SELECT value FROM roster_players WHERE steamId=?")
              .get(player.steamId)
          : null;
        const bySteam = row ? JSON.parse(row.value) : null;
        // Keep current record data on collision; restore fills missing records.
        // A conflicting UUID must never replace a different Steam identity.
        const sameIdentity = byId && byId.steamId === player.steamId;
        const existing = bySteam || (sameIdentity ? byId : null);
        if (existing) {
          remap.set(player.id, existing.id);
          continue;
        }
        const next = { ...player, id: byId ? randomUUID() : player.id };
        if (this.count("roster_players") >= MAX_PLAYERS)
          throw Error("The saved player library is full.");
        this.store.db
          .prepare("INSERT INTO roster_players VALUES (?,?,?)")
          .run(next.id, next.steamId || null, JSON.stringify(next));
        remap.set(player.id, next.id);
      }
      const teams = [];
      for (const team of incoming.teams) {
        const byId = this.getTeam(team.id);
        const row = this.store.db
          .prepare("SELECT value FROM roster_teams WHERE nameKey=?")
          .get(team.name.toLowerCase());
        const byName = row ? JSON.parse(row.value) : null;
        const playerIds = team.playerIds.map((id) => remap.get(id));
        if (new Set(playerIds).size !== playerIds.length)
          throw Error("Imported team contains the same Steam player twice.");
        if (byName) {
          teams.push(byName);
          continue;
        }
        const next = { ...team, id: byId ? randomUUID() : team.id, playerIds };
        if (this.count("roster_teams") >= MAX_TEAMS)
          throw Error("The saved team library is full.");
        this.store.db
          .prepare("INSERT INTO roster_teams VALUES (?,?,?)")
          .run(next.id, next.name.toLowerCase(), JSON.stringify(next));
        teams.push(next);
      }
      return {
        players: remap.size,
        teams: teams.length,
        library: this.snapshot(),
      };
    });
  }
}

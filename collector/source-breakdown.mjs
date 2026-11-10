import protobuf from "protobufjs/light.js";
import { soulsBySource } from "./source-totals.mjs";

// A projection of Valve CMsgMatchMetaDataContents. Unknown fields are skipped;
// optional amount presence is retained instead of manufacturing zero values.
// https://github.com/SteamTracking/Protobufs/blob/e82e5226c26240dc8729acf69f414c0218f31239/deadlock/citadel_gcmessages_common.proto
const schema = protobuf.Root.fromJSON({
  nested: {
    RecordingMetadata: {
      edition: "proto2",
      fields: { matchInfo: { type: "MatchInfo", id: 2 } },
    },
    MatchInfo: {
      edition: "proto2",
      fields: {
        duration: { type: "uint32", id: 1 },
        players: { rule: "repeated", type: "Player", id: 4 },
        matchId: { type: "uint64", id: 6 },
      },
    },
    Player: {
      edition: "proto2",
      fields: {
        accountId: { type: "uint32", id: 1 },
        slot: { type: "uint32", id: 2 },
        stats: { rule: "repeated", type: "PlayerStats", id: 5 },
        team: { type: "uint32", id: 6 },
        heroId: { type: "uint32", id: 12 },
      },
    },
    PlayerStats: {
      edition: "proto2",
      fields: {
        time: { type: "uint32", id: 1 },
        sources: { rule: "repeated", type: "GoldSource", id: 40 },
      },
    },
    GoldSource: {
      edition: "proto2",
      fields: {
        source: { type: "uint32", id: 1 },
        gold: { type: "uint32", id: 4 },
        goldOrbs: { type: "uint32", id: 5 },
      },
    },
  },
}).lookupType("RecordingMetadata");

export function decodePostMatchSources(bytes) {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > 1000000)
    throw Error("Invalid post-match source payload.");
  const raw = schema.toObject(schema.decode(bytes), {
    longs: String,
    defaults: false,
  });
  const match = raw.matchInfo;
  if (
    !match ||
    !/^[1-9]\d{0,14}$/.test(match.matchId || "") ||
    !Number.isSafeInteger(match.duration) ||
    match.duration < 1 ||
    !Array.isArray(match.players) ||
    match.players.length !== 12
  )
    throw Error("Post-match sources require a complete identified match.");
  const slots = new Set();
  const players = match.players.map((player) => {
    // These two enum defaults are explicitly declared by Valve's schema.
    player.team ??= 0;
    if (
      !Number.isInteger(player.slot) ||
      player.slot < 1 ||
      player.slot > 12 ||
      slots.has(player.slot) ||
      ![0, 1].includes(player.team) ||
      !Number.isSafeInteger(player.heroId) ||
      player.heroId <= 0
    )
      throw Error("Invalid post-match source roster.");
    slots.add(player.slot);
    const final = player.stats?.findLast(
      (sample) => sample.time === match.duration,
    );
    const sources = final?.sources;
    if (Array.isArray(sources))
      for (const source of sources) source.source ??= 1;
    if (
      !Array.isArray(sources) ||
      !sources.length ||
      sources.length > 64 ||
      new Set(sources.map((row) => row.source)).size !== sources.length ||
      sources.some((row) => !Number.isSafeInteger(row.source) || row.source < 1)
    )
      throw Error("Final source income is unavailable for every player.");
    return {
      accountId: player.accountId || 0,
      slot: player.slot,
      team: player.team,
      heroId: player.heroId,
      sampleTime: final.time,
      soulsBySource: soulsBySource({
        gold_sources: sources.map((row) => ({
          source: row.source,
          gold: row.gold,
          gold_orbs: row.goldOrbs,
        })),
      }),
    };
  });
  if (
    ![0, 1].every((team) => players.filter((p) => p.team === team).length === 6)
  )
    throw Error("Post-match sources require six players on each team.");
  return { matchId: match.matchId, duration: match.duration, players };
}

export function matchPostMatchSources(decoded, frame) {
  if (
    !decoded ||
    frame?.matchId !== decoded.matchId ||
    !Number.isFinite(frame.duration) ||
    Math.abs(frame.duration - decoded.duration) > 3 ||
    frame.players?.length !== 12 ||
    new Set(frame.players.map((p) => p.id)).size !== 12
  )
    return null;
  const players = decoded.players.map((source) => {
    const expectedId =
      source.accountId > 0
        ? String(source.accountId)
        : String(4000000000 + source.slot);
    const player = frame.players.find(
      (p) =>
        p.id === expectedId &&
        p.slot === source.slot &&
        p.team === source.team &&
        p.heroId === source.heroId,
    );
    if (!player) return null;
    const { accountId: ignored, ...details } = source;
    void ignored;
    return { id: player.id, ...details };
  });
  if (players.some((p) => !p)) return null;
  return {
    version: 1,
    source: "recording-post-match",
    matchId: decoded.matchId,
    duration: decoded.duration,
    players,
  };
}

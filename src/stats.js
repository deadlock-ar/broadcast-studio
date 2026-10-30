export const STATS_KEY = "dlar-stat-panels-v1";
export function metricSupported(metric, match) {
  return (
    match?.mode !== "live" ||
    METRICS[metric]?.live === true ||
    ["deadem", "local-client-demo"].includes(match?.provider)
  );
}
export const API_ROOT = "https://api.deadlock-api.com";
export const METRICS = {
  damage: {
    label: "Hero damage",
    short: "DAMAGE",
    field: "player_damage",
    unit: "Damage to enemy heroes",
    live: true,
  },
  buffs: {
    label: "Permanent buffs",
    short: "BUFFS",
    unit: "Permanent pickups · all types",
    live: false,
  },
  souls: {
    label: "Net worth",
    short: "SOULS",
    field: "net_worth",
    unit: "Current net worth in souls",
    live: true,
  },
  healing: {
    label: "Hero healing",
    short: "HEALING",
    field: "player_healing",
    unit: "Hero healing · includes self healing",
    live: true,
  },
};
const text = (v, max = 48) => (typeof v === "string" ? v.slice(0, max) : "");
export const nonnegative = (v) =>
  v !== null &&
  v !== undefined &&
  v !== "" &&
  Number.isFinite(Number(v)) &&
  Number(v) >= 0
    ? Number(v)
    : null;
export function parseMatchId(value) {
  const id = String(value ?? "").trim();
  if (!/^[1-9]\d{0,14}$/.test(id) || !Number.isSafeInteger(Number(id)))
    throw Error("Enter a numeric Deadlock match ID.");
  return id;
}
export function cleanPanel(value = {}) {
  const v = value && typeof value === "object" ? value : {};
  const names = {};
  for (const [key, name] of Object.entries(v.names || {}).slice(0, 24))
    if (/^\d{1,20}$/.test(key) && text(name)) names[key] = text(name);
  return {
    metric: Object.hasOwn(METRICS, v.metric) ? v.metric : "damage",
    layout: ["boxes", "teams", "ranking"].includes(v.layout)
      ? v.layout
      : "boxes",
    sort: v.sort === "team" ? "team" : "value",
    position: [
      "top-left",
      "top-right",
      "bottom-left",
      "bottom-right",
      "center",
      "custom",
    ].includes(v.position)
      ? v.position
      : "bottom-right",
    theme: v.theme === "ink" ? "ink" : "parchment",
    scale: Number.isFinite(Number(v.scale))
      ? Math.max(0.25, Math.min(2, Number(v.scale)))
      : 1,
    x: Math.max(0, Math.min(1919, Number(v.x) || 0)),
    y: Math.max(0, Math.min(1079, Number(v.y) || 0)),
    width: Math.max(240, Math.min(1880, Number(v.width) || 640)),
    fontSize: Math.max(12, Math.min(36, Number(v.fontSize) || 18)),
    title: text(v.title, 64),
    teamNames: [
      text(v.teamNames?.[0]) || "Amber",
      text(v.teamNames?.[1]) || "Sapphire",
    ],
    names,
  };
}
export function clock(seconds) {
  const n = Math.floor(nonnegative(seconds) || 0);
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
}
export function displayNumber(value) {
  return nonnegative(value) === null
    ? "—"
    : new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(
        value,
      );
}
export function normalizeMetadata(data, expectedId) {
  const info = data?.match_info;
  if (!info || !Array.isArray(info.players) || !info.players.length)
    throw Error(
      "Match metadata is not available yet. Check the ID or try again after the game.",
    );
  const id = parseMatchId(info.match_id);
  if (expectedId && id !== parseMatchId(expectedId))
    throw Error("The API returned a different match. No data was loaded.");
  const duration = nonnegative(info.duration_s) || 0;
  const used = new Set();
  const players = info.players
    .filter(
      (p) =>
        [0, 1].includes(p.team) && Number.isInteger(p.hero_id) && p.hero_id > 0,
    )
    .slice(0, 12)
    .map((p) => {
      const playerId = String(p.account_id || p.player_slot);
      if (used.has(playerId))
        throw Error("The match contains duplicate player records.");
      used.add(playerId);
      const samples = (Array.isArray(p.stats) ? p.stats : [])
        .filter((s) => nonnegative(s.time_stamp_s) !== null)
        .map((s) => ({
          time: Number(s.time_stamp_s),
          damage: nonnegative(s.player_damage),
          souls: nonnegative(s.net_worth),
          healing: nonnegative(s.player_healing),
          kills: nonnegative(s.kills),
          deaths: nonnegative(s.deaths),
          assists: nonnegative(s.assists),
        }))
        .sort((a, b) => a.time - b.time);
      const buffs = Array.isArray(p.power_up_buffs)
        ? p.power_up_buffs
            .filter((b) => b.is_permanent === true)
            .map((b) => ({
              type: text(b.type, 80),
              count: nonnegative(b.value),
              times: (Array.isArray(b.pickup_times_s) ? b.pickup_times_s : [])
                .map(nonnegative)
                .filter((t) => t !== null)
                .sort((a, b) => a - b),
            }))
        : null;
      return {
        id: playerId,
        slot: nonnegative(p.player_slot) || 0,
        heroId: p.hero_id,
        team: p.team,
        name: text(p.player_name) || text(p.personaname),
        samples,
        buffs,
        final: {
          kills: nonnegative(p.kills),
          deaths: nonnegative(p.deaths),
          assists: nonnegative(p.assists),
          souls: nonnegative(p.net_worth),
        },
      };
    });
  if (!players.length)
    throw Error("No player statistics were found for this match.");
  return {
    id,
    mode: "finished",
    duration,
    winningTeam: [0, 1].includes(info.winning_team) ? info.winning_team : null,
    players,
  };
}
export function applyProfileNames(match, profiles) {
  const names = new Map(
    (Array.isArray(profiles) ? profiles : []).map((p) => [
      String(p.account_id),
      text(p.personaname),
    ]),
  );
  return {
    ...match,
    players: match.players.map((p) => ({
      ...p,
      name: names.get(p.id) || p.name,
    })),
  };
}
export function playersAt(match, time = match?.duration) {
  if (!match) return [];
  if (match.mode === "live") return match.players;
  const atEnd = Number(time) >= match.duration;
  return match.players.map((p) => {
    const sample = p.samples.filter((s) => s.time <= time).at(-1);
    let buffs = null;
    if (p.buffs) {
      if (atEnd)
        buffs = p.buffs.every((b) => b.count !== null)
          ? p.buffs.reduce((sum, b) => sum + b.count, 0)
          : null;
      else if (
        p.buffs.every((b) => b.count !== null && b.times.length === b.count)
      )
        buffs = p.buffs.reduce(
          (sum, b) => sum + b.times.filter((t) => t <= time).length,
          0,
        );
    }
    return {
      ...p,
      damage: sample?.damage ?? null,
      healing: sample?.healing ?? null,
      souls: (atEnd ? p.final.souls : sample?.souls) ?? null,
      buffs,
      kills: (atEnd ? p.final.kills : sample?.kills) ?? null,
      deaths: (atEnd ? p.final.deaths : sample?.deaths) ?? null,
      assists: (atEnd ? p.final.assists : sample?.assists) ?? null,
      sampleTime: sample?.time ?? null,
    };
  });
}
export function sortPlayers(players, panel) {
  return [...players].sort((a, b) => {
    if (panel.sort === "team" || panel.layout === "teams") {
      const team = a.team - b.team;
      if (team) return team;
    }
    if (panel.sort === "value") {
      const av = nonnegative(a[panel.metric]),
        bv = nonnegative(b[panel.metric]);
      if (av === null && bv !== null) return 1;
      if (bv === null && av !== null) return -1;
      if (av !== bv) return (bv || 0) - (av || 0);
    }
    return a.slot - b.slot || a.id.localeCompare(b.id);
  });
}
export function panelUrl(origin, match, panel, branding = {}, time) {
  const url = new URL(origin);
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  url.searchParams.set("view", "stats");
  url.searchParams.set("match", parseMatchId(match.id));
  url.searchParams.set("source", match.mode === "live" ? "live" : "finished");
  const state = { panel: cleanPanel(panel), event: text(branding.event, 80) };
  if (
    match.mode !== "live" &&
    nonnegative(time) !== null &&
    time < match.duration
  )
    state.time = time;
  url.hash = new URLSearchParams({ panel: JSON.stringify(state) }).toString();
  return url.href;
}
export function readPanelUrl(href) {
  const url = new URL(href);
  let state = {};
  try {
    const raw = new URLSearchParams(url.hash.slice(1)).get("panel");
    if (raw?.length < 8000) state = JSON.parse(raw);
  } catch {
    /* default panel */
  }
  return {
    id: parseMatchId(url.searchParams.get("match")),
    mode: url.searchParams.get("source") === "live" ? "live" : "finished",
    panel: cleanPanel(state?.panel),
    event: text(state?.event, 80),
    time: nonnegative(state?.time),
  };
}
export async function loadFinishedMatch(id, signal, fetcher = fetch) {
  id = parseMatchId(id);
  const response = await fetcher(
    `${API_ROOT}/v1/matches/${id}/metadata?is_custom=true`,
    { signal },
  );
  if (!response.ok)
    throw Error(
      response.status === 429
        ? "The stats API is rate limited. Wait before trying again."
        : `Match metadata is unavailable (HTTP ${response.status}). Check the ID or try again later.`,
    );
  let match = normalizeMetadata(await response.json(), id);
  try {
    const profiles = await fetcher(
      `${API_ROOT}/v1/players/steam?account_ids=${match.players.map((p) => p.id).join(",")}`,
      { signal },
    );
    if (profiles.ok) match = applyProfileNames(match, await profiles.json());
  } catch (error) {
    if (signal?.aborted)
      throw error; /* Names can be edited; stats remain usable. */
  }
  try {
    match = { ...match, heroInfo: await loadStatHeroes(signal, fetcher) };
  } catch (error) {
    if (signal?.aborted) throw error; /* Bundled artwork remains available. */
  }
  return match;
}

export async function loadStatHeroes(signal, fetcher = fetch) {
  const response = await fetcher(`${API_ROOT}/v1/assets/heroes`, {
    signal,
  });
  if (!response.ok) throw Error("Hero catalogue unavailable.");
  const heroes = await response.json();
  const result = {};
  for (const hero of Array.isArray(heroes) ? heroes : []) {
    const image = hero?.images?.icon_hero_card_webp;
    if (
      !Number.isSafeInteger(hero.id) ||
      hero.id < 1 ||
      typeof image !== "string"
    )
      continue;
    try {
      const url = new URL(image);
      if (
        url.protocol === "https:" &&
        url.hostname === "assets-bucket.deadlock-api.com"
      )
        result[hero.id] = {
          id: hero.id,
          name: text(hero.name),
          image: url.href,
        };
    } catch {
      /* Unknown image source; use the bundled catalogue. */
    }
  }
  return result;
}

// One projection stream: no GROUP BY/ORDER BY that would wait until match end.
export const LIVE_QUERY = `SELECT tick, entity_index, delta_type,
CAST("m_steamID" AS VARCHAR) AS steam_id, "m_iszPlayerName" AS player_name, "m_iTeamNum" AS team,
"m_PlayerDataGlobal__m_nHeroID" AS hero_id,
"m_PlayerDataGlobal__m_iHeroDamage" AS damage,
"m_PlayerDataGlobal__m_iHeroHealing" AS healing,
"m_PlayerDataGlobal__m_iGoldNetWorth" AS souls,
"m_PlayerDataGlobal__m_iPlayerKills" AS kills,
"m_PlayerDataGlobal__m_iDeaths" AS deaths,
"m_PlayerDataGlobal__m_iPlayerAssists" AS assists
FROM CCitadelPlayerController`;
export function liveQueryUrl(id) {
  const url = new URL(`${API_ROOT}/v1/matches/demo/live/query`);
  url.searchParams.set("match_id", parseMatchId(id));
  url.searchParams.set("query", LIVE_QUERY);
  return url.href;
}
// A relay refusal is different from an API/parser failure or a rate limit.
// Both progress events and terminal errors may carry the relay's explanation.
export function liveFeedMessage(data, event = "error") {
  let value = data;
  try {
    value = JSON.parse(data);
  } catch {
    /* Some providers return plain text instead of a JSON event. */
  }
  const message = text(
    value && typeof value === "object" ? value.error || value.message : value,
    1000,
  )
    .replace(/^(?:live broadcast error:\s*)+/i, "")
    .trim();
  if (/broadcast has not started yet|relay never started/i.test(message))
    return event === "status"
      ? "Valve’s spectator relay has not started the broadcast yet. The API is retrying for up to a minute…"
      : "Valve’s spectator relay did not start this broadcast during the connection attempt. Check that the game is still running and watchable in Deadlock. Reconnecting cannot guarantee access; finished-match statistics remain available after the game.";
  if (/rate.?limit|too many requests/i.test(message))
    return "The live API is rate limited. Wait before reconnecting; repeated attempts do not unlock a broadcast.";
  if (
    /schema|column.*not found|no field named|planning error|parser|parse error/i.test(
      message,
    )
  )
    return `The data provider could not decode the live feed. This does not establish that the match is private. ${message.slice(0, 220)}`;
  return (
    message.slice(0, 400) ||
    (event === "status"
      ? "Connecting to the spectator broadcast…"
      : "The live feed stopped. Check the match ID and spectator access.")
  );
}
export function reduceLiveRow(previous, row) {
  if (!row || typeof row !== "object") return previous;
  const entity = nonnegative(row.entity_index);
  if (entity === null) return previous;
  const old = previous.get(entity);
  if (old && Number(row.tick) < old.tick) return previous;
  // Controller deletions during disconnects keep their last known player stats.
  if (row.delta_type === "delete") return previous;
  const steamId =
    typeof row.steam_id === "string" && /^\d+$/.test(row.steam_id)
      ? row.steam_id
      : null;
  let accountId = steamId;
  if (
    steamId &&
    BigInt(steamId) >= 76561197960265728n &&
    BigInt(steamId) <= 76561202255233023n
  )
    accountId = String(BigInt(steamId) - 76561197960265728n);
  const reused = accountId && old?.id && old.id !== accountId;
  const player = {
    ...(reused ? {} : old),
    entity,
    tick: nonnegative(row.tick) ?? old?.tick ?? 0,
  };
  if (accountId && accountId !== "0") player.id = accountId;
  if (row.team === 2 || row.team === 3) player.team = row.team - 2;
  if (nonnegative(row.hero_id) > 0) player.heroId = Number(row.hero_id);
  if (text(row.player_name)) player.name = text(row.player_name);
  for (const key of [
    "damage",
    "healing",
    "souls",
    "kills",
    "deaths",
    "assists",
  ])
    if (nonnegative(row[key]) !== null) player[key] = Number(row[key]);
  player.slot = entity;
  player.buffs = null; // No verified live pickup-count field in this controller schema.
  const next = new Map(previous);
  next.set(entity, player);
  return next;
}
export function livePlayers(rows) {
  const byId = new Map();
  for (const p of rows.values())
    if (p.id && p.heroId && [0, 1].includes(p.team)) {
      const old = byId.get(p.id);
      if (!old || old.tick <= p.tick) byId.set(p.id, p);
    }
  return [...byId.values()]
    .sort((a, b) => a.team - b.team || a.slot - b.slot)
    .slice(0, 12);
}
// Supports chunk boundaries, multiline data, CRLF and SSE comments without retaining the stream.
export function createSseParser(onEvent) {
  let buffer = "",
    event = "message",
    lines = [];
  return (chunk) => {
    buffer += chunk;
    if (buffer.length > 1_000_000)
      throw Error("The live feed sent an oversized event.");
    let end;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, end).replace(/\r$/, "");
      buffer = buffer.slice(end + 1);
      if (!line) {
        if (lines.length) onEvent({ event, data: lines.join("\n") });
        event = "message";
        lines = [];
      } else if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:"))
        lines.push(line.slice(5).replace(/^ /, ""));
    }
  };
}
export async function streamLiveMatch(
  id,
  { signal, onEvent, fetcher = fetch },
) {
  const response = await fetcher(liveQueryUrl(id), {
    signal,
    headers: { Accept: "text/event-stream" },
  });
  if (!response.ok) {
    const detail =
      typeof response.text === "function"
        ? await response.text().catch(() => "")
        : "";
    throw Error(
      liveFeedMessage(
        response.status === 429
          ? "rate limited"
          : detail ||
              `The live feed could not be opened (HTTP ${response.status}). The API or spectator broadcast may be unavailable.`,
      ),
    );
  }
  if (
    !response.headers.get("content-type")?.includes("text/event-stream") ||
    !response.body
  )
    throw Error("The API did not return a live event stream.");
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  const parse = createSseParser(onEvent);
  try {
    while (!signal.aborted) {
      const { value, done } = await reader.read();
      if (done) break;
      parse(decoder.decode(value, { stream: true }));
    }
    parse(decoder.decode() + "\n\n");
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

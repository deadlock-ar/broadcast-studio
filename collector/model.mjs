export const number = (value) =>
  Number.isFinite(value) && value >= 0 ? value : null;
export const clone = (value) => structuredClone(value);
export function matchId(value) {
  const id = String(value ?? "");
  if (!/^[1-9]\d{0,14}$/.test(id) || !Number.isSafeInteger(Number(id)))
    throw Error("Enter a numeric match ID.");
  return id;
}
export function sessionId(value) {
  const id = String(value ?? '');
  if (/^local-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id)) return id;
  return matchId(id);
}
export function broadcastUrl(value, id) {
  if (!value) return null;
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !url.hostname.endsWith(".steamcontent.com") ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    !new RegExp(`^/tv/${matchId(id)}_\\d+/?$`).test(url.pathname)
  )
    throw Error(
      "Use the Valve broadcast URL for this match, ending in /tv/MATCH_ID_TOKEN.",
    );
  return url.href.replace(/\/$/, "");
}
export function completeRoster(players) {
  return (
    players?.length === 12 &&
    new Set(players.map((p) => p.id)).size === 12 &&
    [0, 1].every((t) => players.filter((p) => p.team === t).length === 6)
  );
}
export function emptySession(id, mode = "live") {
  return {
    version: 1,
    id: sessionId(id),
    mode,
    provider: "deadem",
    status: "connecting",
    message: "Connecting to Valve broadcast…",
    updatedAt: null,
    sequence: 0,
    match: null,
    effects: [],
    recentHits: [],
    result: null,
    published: null,
    settings: {
      delayMs: 0,
      hud: { x: 460, y: 22, gap: 12, size: 62, teamGap: 145 },
      names: {},
    },
  };
}
export function mergePlayers(old = [], incoming = []) {
  // A disconnected controller must not erase its last recorded totals.
  const next = new Map(old.map((p) => [p.id, p]));
  for (const p of incoming) {
    const prev = next.get(p.id) ?? {};
    next.set(p.id, {
      ...prev,
      ...Object.fromEntries(
        Object.entries(p).filter(([, v]) => v !== null && v !== undefined),
      ),
    });
  }
  return [...next.values()].sort((a, b) => a.team - b.team || a.slot - b.slot);
}
export function applyFrame(session, frame, now = Date.now()) {
  if (session.result) return session; // Frozen result cannot be overwritten by disconnects or restart.
  const players = mergePlayers(session.match?.players, frame.players);
  session.match = {
    ...frame,
    id: session.id,
    mode: "live",
    provider: "deadem",
    players,
    complete: completeRoster(players),
    currentComplete: completeRoster(frame.players),
  };
  session.updatedAt = now;
  session.sequence++;
  session.status = "live";
  session.message =
    session.mode === "replay"
      ? "Replay rehearsal · not a live game"
      : "Receiving Deadem updates";
  if (frame.endObserved) {
    session.result = {
      match: clone(session.match),
      winner: [0, 1].includes(frame.winner) ? frame.winner : null,
      endObserved: true,
      verification: "collector",
      captureMode: session.mode,
      capturedAt: now,
    };
    session.status = "finished";
    session.message = "Game ended · results saved for review";
    session.effects = [];
    session.recentHits = [];
  }
  return session;
}
export function applyInterruption(session, message) {
  if (session.result) return;
  session.status = "interrupted";
  session.message = message;
  session.effects = [];
  session.recentHits = [];
}
export function publishResult(session, presentation = {}) {
  if (!session.result || !completeRoster(session.result.match.players))
    throw Error("A complete ended-game result is required before publishing.");
  const winner = Number(presentation.winner);
  if (
    ![0, 1].includes(winner) ||
    presentation.winner === null ||
    presentation.winner === ""
  )
    throw Error("Confirm the winning team.");
  const label = (v) => (typeof v === "string" ? v.slice(0, 80) : "");
  const image = (v) =>
    typeof v === "string" &&
    v.length < 600000 &&
    (/^https:\/\//.test(v) ||
      /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v))
      ? v
      : "";
  const teams = [0, 1].map((t) => ({
    name: label(presentation.teams?.[t]?.name) || (t ? "Sapphire" : "Amber"),
    logo: image(presentation.teams?.[t]?.logo),
    score: Math.max(
      0,
      Math.min(99, Number(presentation.teams?.[t]?.score) || 0),
    ),
  }));
  session.published = {
    ...clone(session.result),
    winner,
    teams,
    event: label(presentation.event),
    round: label(presentation.round),
    format: ["BO1", "BO3", "BO5", "BO7"].includes(presentation.format)
      ? presentation.format
      : "BO3",
    game: Math.max(1, Math.min(99, Number(presentation.game) || 1)),
    names: clone(session.settings.names),
    publishedAt: Date.now(),
  };
  return session.published;
}
export function cleanSettings(
  value = {},
  previous = emptySession("1").settings,
) {
  const bounded = (v, min, max, fallback) =>
    Number.isFinite(Number(v))
      ? Math.max(min, Math.min(max, Number(v)))
      : fallback;
  const names = Object.fromEntries(
    Object.entries(value.names ?? previous.names)
      .filter(([id, name]) => /^\d{1,10}$/.test(id) && typeof name === "string")
      .slice(0, 12)
      .map(([id, name]) => [id, name.slice(0, 48)]),
  );
  return {
    delayMs: bounded(value.delayMs ?? previous.delayMs, 0, 120000, 0),
    names,
    hudOrder: [...new Set(value.hudOrder ?? previous.hudOrder ?? [])]
      .filter((id) => typeof id === "string" && /^\d{1,10}$/.test(id))
      .slice(0, 12),
    hud: Object.fromEntries(
      Object.entries({
        x: [0, 1850],
        y: [0, 1000],
        gap: [0, 80],
        size: [24, 90],
        teamGap: [0, 500],
      }).map(([k, [min, max]]) => [
        k,
        bounded(value.hud?.[k] ?? previous.hud[k], min, max, previous.hud[k]),
      ]),
    ),
  };
}

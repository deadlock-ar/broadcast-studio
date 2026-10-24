export const STORAGE_KEY = "dlar-studio-v1";
export const DEFAULT_CONFIG = {
  event: "Deadlock AR Community Cup",
  round: "Grand final",
  format: "BO3",
  game: 1,
  teams: [
    { name: "NCSU RED", tag: "RED", logo: "", score: 0 },
    { name: "KANSAS", tag: "KAN", logo: "", score: 0 },
  ],
  useSourceNames: false,
  layout: "board",
  transparent: false,
  showBans: true,
  showTimer: true,
  pickEffects: true,
  voiceLines: true,
  voiceVolume: 70,
  firstPick: 1,
};

export function parseDraftCode(input) {
  const value = input.trim();
  if (/^[A-Z0-9]{8}$/i.test(value)) return value.toUpperCase();
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      "Paste a Statlocker draft link or its eight-character code.",
    );
  }
  if (
    url.protocol !== "https:" ||
    !["statlocker.gg", "www.statlocker.gg"].includes(url.hostname)
  )
    throw new Error("Use a draft link from https://statlocker.gg.");
  const match = url.pathname.match(/^\/draft\/([A-Z0-9]{8})\/?$/i);
  if (!match)
    throw new Error("The link should look like statlocker.gg/draft/VBWWGH17.");
  return match[1].toUpperCase();
}

export function safeImage(value) {
  if (typeof value !== "string" || value.length > 300000) return "";
  if (/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value))
    return value;
  try {
    const u = new URL(value);
    return u.protocol === "https:" ? u.href : "";
  } catch {
    return "";
  }
}

export function cleanConfig(value = {}) {
  if (!value || typeof value !== "object") value = {};
  const str = (v, fallback, max = 80) =>
    typeof v === "string" ? v.slice(0, max) : fallback;
  const num = (v, fallback, max) =>
    Number.isFinite(Number(v))
      ? Math.max(0, Math.min(max, Math.floor(Number(v))))
      : fallback;
  return {
    ...DEFAULT_CONFIG,
    event: str(value.event, DEFAULT_CONFIG.event),
    round: str(value.round, DEFAULT_CONFIG.round),
    format: ["BO1", "BO3", "BO5", "BO7"].includes(value.format)
      ? value.format
      : "BO3",
    game: Math.max(1, num(value.game, 1, 99)),
    layout: value.layout === "lower" ? "lower" : "board",
    transparent: value.transparent === true,
    useSourceNames: value.useSourceNames === true,
    showBans: value.showBans !== false,
    showTimer: value.showTimer !== false,
    pickEffects: value.pickEffects !== false,
    voiceLines: value.voiceLines !== false,
    voiceVolume: num(value.voiceVolume, 70, 100),
    firstPick: value.firstPick === 2 ? 2 : 1,
    teams: [0, 1].map((i) => ({
      name: str(value.teams?.[i]?.name, DEFAULT_CONFIG.teams[i].name, 48),
      tag: str(value.teams?.[i]?.tag, DEFAULT_CONFIG.teams[i].tag, 5),
      logo: safeImage(value.teams?.[i]?.logo),
      score: num(value.teams?.[i]?.score, 0, 99),
    })),
  };
}

// Keep broadcast data only; discard participant sessions, owner data, and unrelated fields.
export function cleanSnapshot(state) {
  if (!state || !Array.isArray(state.steps))
    throw new Error("Statlocker sent an unsupported draft state.");
  return {
    draftCode: state.draftCode,
    status: state.status || "WAITING",
    currentStepIndex: state.currentStepIndex ?? 0,
    steps: state.steps
      .filter(
        (s) =>
          [1, 2].includes(s.teamNumber) &&
          ["pick", "ban"].includes(s.selectionType),
      )
      .slice(0, 100)
      .map((s) => ({
        id: s.id,
        teamNumber: s.teamNumber,
        selectionType: s.selectionType,
        heroId: s.heroId || null,
        selectionNumber: s.selectionNumber,
        wasRandom: s.wasRandom === true,
      })),
    teams: (state.teams || []).slice(0, 2).map((t) => ({
      teamNumber: t.teamNumber,
      displayName: String(t.displayName || "").slice(0, 48),
      teamLogo: safeImage(t.teamLogo),
    })),
    currentTimer: state.currentTimer || null,
  };
}

export function teamSlots(snapshot, team, type) {
  const steps = (snapshot?.steps || []).filter(
    (s) => s.teamNumber === team && s.selectionType === type,
  );
  const minimum = type === "pick" ? 6 : 3;
  return Array.from(
    { length: Math.max(minimum, steps.length) },
    (_, i) =>
      steps[i] || {
        id: `${team}-${type}-${i}`,
        teamNumber: team,
        selectionType: type,
        heroId: null,
      },
  );
}

// Competitive three-ban order. Teams denote lobby sides, not pick order.
export const DRAFT_RULE = "competitive-3ban-2026-10";
export const DRAFT_ORDER = [
  [1, "ban"],
  [2, "ban"],
  [1, "ban"],
  [2, "ban"],
  [1, "pick"],
  [2, "pick"],
  [2, "pick"],
  [1, "pick"],
  [2, "pick"],
  [1, "pick"],
  [2, "ban"],
  [1, "ban"],
  [2, "pick"],
  [1, "pick"],
  [1, "pick"],
  [2, "pick"],
  [1, "pick"],
  [2, "pick"],
];
export function makeDemo() {
  const heroes = [2, 3, 6, 4, 7, 1, 13, 15, 10, 16, 12, 17];
  return {
    draftCode: "DEMO",
    status: "ACTIVE",
    currentStepIndex: 12,
    teams: [],
    currentTimer: null,
    steps: DRAFT_ORDER.map(([teamNumber, selectionType], i) => ({
      id: `demo-${i}`,
      selectionNumber: i + 1,
      teamNumber,
      selectionType,
      heroId: heroes[i] || null,
    })),
  };
}

export function encodeConfig(config) {
  const bytes = new TextEncoder().encode(JSON.stringify(cleanConfig(config)));
  let raw = "";
  for (const b of bytes) raw += String.fromCharCode(b);
  return btoa(raw)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export function decodeConfig(value) {
  if (!value || value.length > 850000) return null;
  try {
    const raw = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
    return cleanConfig(
      JSON.parse(
        new TextDecoder().decode(Uint8Array.from(raw, (c) => c.charCodeAt(0))),
      ),
    );
  } catch {
    return null;
  }
}

export function broadcastUrl(
  config,
  code,
  demo = false,
  origin = window.location.origin,
  snapshot = null,
) {
  const u = new URL("/", origin);
  u.searchParams.set("view", "overlay");
  if (code) u.searchParams.set("draft", code);
  if (demo) u.searchParams.set("demo", "1");
  const fragment = new URLSearchParams({ config: encodeConfig(config) });
  if (!code && !demo && snapshot)
    fragment.set("state", encodeData(cleanSnapshot(snapshot)));
  u.hash = fragment.toString();
  return u.href;
}

export function encodeData(data) {
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  let raw = "";
  for (const b of bytes) raw += String.fromCharCode(b);
  return btoa(raw)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
export function decodeSnapshot(value) {
  if (!value || value.length > 50000) return null;
  try {
    const raw = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
    return cleanSnapshot(
      JSON.parse(
        new TextDecoder().decode(Uint8Array.from(raw, (c) => c.charCodeAt(0))),
      ),
    );
  } catch {
    return null;
  }
}

export function openDraftConnection(code, callbacks, options = {}) {
  const Socket = options.WebSocket || globalThis.WebSocket;
  const schedule = options.setTimeout || setTimeout;
  const cancel = options.clearTimeout || clearTimeout;
  let socket,
    retry,
    watchdog,
    stopped = false,
    attempt = 0,
    received = false;
  const sessionId = options.sessionId || crypto.randomUUID();
  function status(state, message) {
    callbacks.onStatus?.({ state, message });
  }
  function connect() {
    if (stopped) return;
    received = false;
    status(
      attempt ? "reconnecting" : "connecting",
      attempt
        ? "Reconnecting; keeping the last draft on screen."
        : "Connecting to Statlocker…",
    );
    try {
      socket = new Socket("wss://statlocker.gg/ws/draft");
    } catch {
      reconnect();
      return;
    }
    watchdog = schedule(() => socket?.close(), 12000);
    socket.onopen = () => {
      if (stopped) return;
      socket.send(
        JSON.stringify({
          type: "JOIN_DRAFT",
          draftCode: code,
          role: "SPECTATOR",
          displayName: "Deadlock AR Broadcast",
          steamAccountId: null,
          browserSessionId: sessionId,
          previousFrontendSessionId: null,
          ownerToken: null,
          password: options.password || null,
        }),
      );
    };
    socket.onmessage = (event) => {
      if (stopped) return;
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        callbacks.onNotice?.("An unreadable update was ignored.");
        return;
      }
      if (msg.type === "DRAFT_STATE_UPDATE") {
        try {
          const snapshot = cleanSnapshot(msg.draftState);
          if (snapshot.draftCode !== code) return;
          const initial = !received;
          received = true;
          attempt = 0;
          cancel(watchdog);
          status("live", "Receiving live draft updates.");
          callbacks.onSnapshot(snapshot, { initial });
        } catch (e) {
          callbacks.onNotice?.(e.message);
        }
      } else if (msg.type === "TIMER_UPDATE" && received)
        callbacks.onTimer?.(msg.timerState);
      else if (msg.type === "ERROR") {
        stopped = true;
        cancel(watchdog);
        status(
          "error",
          String(msg.message || "This draft could not be joined.").slice(
            0,
            250,
          ),
        );
        socket.close();
      } else if (msg.type === "REMATCH_INITIATED")
        callbacks.onNotice?.(
          `A rematch was created (${msg.newDraftCode}). Connect its new link when ready.`,
        );
      else if (msg.type === "DRAFT_NOTICE")
        callbacks.onNotice?.(String(msg.message).slice(0, 250));
    };
    socket.onerror = () => {
      /* onclose schedules one retry */
    };
    socket.onclose = reconnect;
  }
  function reconnect() {
    cancel(watchdog);
    if (stopped) return;
    attempt++;
    status(
      "reconnecting",
      "Connection interrupted; keeping the last draft on screen.",
    );
    retry = schedule(
      connect,
      Math.min(1000 * 2 ** Math.min(attempt - 1, 5), 30000),
    );
  }
  connect();
  return () => {
    stopped = true;
    cancel(retry);
    cancel(watchdog);
    if (socket) {
      socket.onclose = null;
      socket.onmessage = null;
      socket.onopen = null;
      socket.close();
    }
  };
}

import http from "node:http";
import { readFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { SessionStore } from "./store.mjs";
import {
  matchId,
  broadcastUrl,
  emptySession,
  applyFrame,
  applyInterruption,
  publishResult,
  cleanSettings,
} from "./model.mjs";
import { normalizeMetadata, playersAt } from "../src/stats.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.DLAR_COLLECTOR_PORT || 8766);
const store = new SessionStore(
  path.resolve(process.env.DLAR_DATA_DIR || path.join(root, ".dlar-collector")),
);
await store.load();
const catalog = JSON.parse(
  await readFile(new URL("./data/ultimates.json", import.meta.url), "utf8"),
);
const clients = new Set();
let worker = null,
  activeId = null,
  savedAt = 0;
const allowedOrigins = new Set([
  "https://dlar-draft.vercel.app",
  ...(process.env.DLAR_ALLOWED_ORIGINS || "").split(",").filter(Boolean),
]);
const localOrigin = (origin) => {
  try {
    const u = new URL(origin);
    return (
      u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname)
    );
  } catch {
    return false;
  }
};
function emit(id) {
  const state = store.sessions.get(id);
  const event = `data: ${JSON.stringify(state)}\n\n`;
  for (const client of clients)
    if (client.id === id) {
      if (client.response.writableLength > 2000000) {
        client.response.destroy();
        clients.delete(client);
      } else client.response.write(event);
    }
}
function persist(state) {
  store.save(state).catch((error) => {
    state.message = `Could not save results: ${error.message}`;
    state.storageError = true;
    emit(state.id);
  });
}
function launch(options) {
  const id = matchId(options.id);
  const prior = store.sessions.get(id);
  if (worker)
    throw Error("Stop the current collector before starting another game.");
  if (prior?.result && !(options.mode === "replay" && prior.mode === "replay"))
    throw Error("This result is already saved. Review it from Saved games.");
  const state = prior?.result
    ? {
        ...emptySession(id, options.mode),
        settings: prior.settings,
        published: prior.published,
      }
    : prior || emptySession(id, options.mode);
  state.mode = options.mode;
  state.status = "connecting";
  state.effects = [];
  state.recentHits = [];
  store.sessions.set(id, state);
  activeId = id;
  const current = new Worker(new URL("./worker.mjs", import.meta.url), {
    workerData: options,
  });
  worker = current;
  current.on("message", (message) => {
    if (worker !== current) return;
    if (message.type === "frame") {
      applyFrame(state, message.frame);
      if (!state.result) state.effects = message.effects;
    }
    if (message.type === "hit" && !state.result)
      state.recentHits = [
        ...state.recentHits.filter((h) => Date.now() - h.at < 5000),
        { ...message.hit, at: Date.now() },
      ].slice(-40);
    if (message.type === "status" && !state.result) {
      state.status = message.status;
      state.message = message.message;
      state.effects = [];
      state.recentHits = [];
    }
    if (message.type === "ended") {
      state.effects = [];
      state.recentHits = [];
    }
    emit(id);
    if (state.result || Date.now() - savedAt > 2000) {
      savedAt = Date.now();
      persist(state);
    }
  });
  current.on("error", (error) => {
    applyInterruption(state, `Collector error: ${error.message}`);
    persist(state);
    emit(id);
  });
  current.on("exit", () => {
    if (worker !== current) return;
    worker = null;
    if (!state.result)
      applyInterruption(
        state,
        state.message || "Collector stopped before game end",
      );
    persist(state);
    emit(id);
  });
  emit(id);
  return state;
}
const json = (response, status, value) => {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(value));
};
async function body(request) {
  if (!request.headers["content-type"]?.startsWith("application/json"))
    throw Error("JSON request required");
  let content = "";
  for await (const part of request) {
    content += part;
    if (content.length > 2000000) throw Error("Request too large");
  }
  return JSON.parse(content || "{}");
}
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".woff2": "font/woff2",
  ".json": "application/json",
  ".mp3": "audio/mpeg",
};
const server = http.createServer(async (request, response) => {
  const origin = request.headers.origin;
  const host = request.headers.host || "";
  if (
    !new RegExp(`^(?:127\\.0\\.0\\.1|localhost):${port}$`).test(host) ||
    (origin && !allowedOrigins.has(origin) && !localOrigin(origin))
  ) {
    response.writeHead(403).end("Origin not allowed");
    return;
  }
  if (origin) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
  }
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (request.method === "OPTIONS") {
    response.writeHead(204).end();
    return;
  }
  try {
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    if (url.pathname === "/api/collector/health") {
      json(response, 200, {
        version: 1,
        activeId,
        running: Boolean(worker),
        catalog,
        games: [...store.sessions.values()].map((s) => ({
          id: s.id,
          status: s.status,
          mode: s.mode,
          published: Boolean(s.published),
          ended: Boolean(s.result),
        })),
      });
      return;
    }
    if (url.pathname === "/api/collector/start" && request.method === "POST") {
      const v = await body(request),
        id = matchId(v.id),
        mode = v.mode === "replay" ? "replay" : "live";
      json(
        response,
        200,
        launch({
          id,
          mode,
          broadcastUrl: broadcastUrl(v.broadcastUrl, id),
          replaySpeed: [1, 4, 16, 32].includes(Number(v.replaySpeed))
            ? Number(v.replaySpeed)
            : 16,
          replayFrom: Math.max(0, Math.min(7200, Number(v.replayFrom) || 0)),
        }),
      );
      return;
    }
    if (url.pathname === "/api/collector/stop" && request.method === "POST") {
      await body(request);
      const current = worker;
      worker = null;
      if (current) await current.terminate();
      const state = store.sessions.get(activeId);
      if (state) {
        applyInterruption(
          state,
          "Stopped by admin · last values saved; no game-over signal assumed",
        );
        persist(state);
        emit(state.id);
      }
      json(response, 200, { stopped: true });
      return;
    }
    const id = matchId(url.searchParams.get("match"));
    const state = store.sessions.get(id);
    if (!state) {
      json(response, 404, {
        error: "This match has not been collected. Start it in Live desk.",
      });
      return;
    }
    if (url.pathname === "/api/collector/state") {
      json(response, 200, state);
      return;
    }
    if (url.pathname === "/api/collector/events") {
      response.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      });
      response.write(`data: ${JSON.stringify(state)}\n\n`);
      const client = { id, response };
      clients.add(client);
      const beat = setInterval(() => response.write(": heartbeat\n\n"), 10000);
      request.on("close", () => {
        clearInterval(beat);
        clients.delete(client);
      });
      return;
    }
    if (
      url.pathname === "/api/collector/settings" &&
      request.method === "POST"
    ) {
      state.settings = cleanSettings(await body(request), state.settings);
      await store.save(state);
      emit(id);
      json(response, 200, state);
      return;
    }
    if (
      url.pathname === "/api/collector/publish" &&
      request.method === "POST"
    ) {
      publishResult(state, await body(request));
      await store.save(state);
      emit(id);
      json(response, 200, state);
      return;
    }
    if (url.pathname === "/api/collector/verify" && request.method === "POST") {
      await body(request);
      if (!state.result)
        throw Error("Wait for a game-over signal before verifying.");
      const upstream = await fetch(
        `https://api.deadlock-api.com/v1/matches/${id}/metadata?is_custom=true`,
        { signal: AbortSignal.timeout(30000) },
      );
      if (!upstream.ok)
        throw Error(
          `Finished metadata is not available yet (HTTP ${upstream.status}). Your captured result is retained.`,
        );
      const raw = await upstream.json(),
        normalized = normalizeMetadata(raw, id);
      const players = playersAt(normalized, normalized.duration).map((p) => ({
        ...p,
        name:
          state.match?.players.find((previous) => previous.id === p.id)?.name ||
          p.name,
      }));
      const actualIds = state.result.match.players
        .map((p) => p.id)
        .sort()
        .join(",");
      if (
        players
          .map((p) => p.id)
          .sort()
          .join(",") !== actualIds
      )
        throw Error(
          "Finished metadata roster does not match the collected game.",
        );
      const rawWinner = raw.match_info?.winning_team;
      state.result = {
        ...state.result,
        match: {
          ...state.result.match,
          duration: normalized.duration,
          players,
          complete: true,
        },
        winner: [0, 1].includes(rawWinner) ? rawWinner : state.result.winner,
        verification: "metadata",
        verifiedAt: Date.now(),
      };
      await store.save(state);
      emit(id);
      json(response, 200, state);
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      json(response, 404, { error: "Unknown endpoint" });
      return;
    }
  } catch (error) {
    if (request.url.startsWith("/api/")) {
      json(response, 400, { error: error.message });
      return;
    }
  }
  try {
    const pathname = decodeURIComponent(
      new URL(request.url, "http://localhost").pathname,
    );
    const base = path.join(root, "dist");
    const target = path.resolve(
      base,
      "." + (pathname === "/" ? "/index.html" : pathname),
    );
    if (!target.startsWith(base + path.sep)) throw Error("Invalid path");
    const file = await readFile(target);
    response.writeHead(200, {
      "Content-Type": types[path.extname(target)] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    response.end(file);
  } catch {
    response
      .writeHead(404)
      .end(
        "Build the website with npm run build, then reopen the local studio.",
      );
  }
});
server.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
server.listen(port, "127.0.0.1", () =>
  console.log(
    `Deadlock AR Live desk: http://127.0.0.1:${port}/?tab=live\nKeep this window open while broadcasting. Results: ${store.directory}`,
  ),
);
await access(path.join(root, "dist/index.html")).catch(() =>
  console.log(
    "Website build not found. Run npm run build in the project root.",
  ),
);
async function shutdown() {
  if (worker) await worker.terminate();
  for (const state of store.sessions.values()) {
    applyInterruption(state, "Collector shut down before game end");
    await store.save(state);
  }
  server.closeAllConnections();
  server.close();
}
process.once("SIGINT", () => shutdown().then(() => process.exit(0)));
process.once("SIGTERM", () => shutdown().then(() => process.exit(0)));

import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { BroadcastDatabase } from "./database.mjs";
import { AdminAuth } from "./auth.mjs";
import { CollectorEngine } from "./engine.mjs";
import { SharedFeeds } from "./feeds.mjs";
import { blankDraft } from "../src/workspace-model.js";
import { reportOutput } from "./reports.mjs";
import { applySeriesWin } from "./enrichment.mjs";
import { Archive } from "./archive.mjs";
import { Tournaments, inTournament } from "./tournaments.mjs";
import { Publisher } from "./publisher.mjs";
import { Backups, exportBackup, prepareRestore } from "./backups.mjs";
import {
  matchId,
  sessionId,
  broadcastUrl,
  cleanSettings,
  publishResult,
} from "./model.mjs";
import { normalizeMetadata, playersAt } from "../src/stats.js";
import { resolveMatchOverlay } from "../src/match-overlay.js";
import {
  patchWorkspace,
  applyOperations,
  OUTPUTS,
} from "../src/workspace-model.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".mp3": "audio/mpeg",
};
function json(res, code, data) {
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
}
async function body(req, limit = 2000000) {
  if (!req.headers["content-type"]?.startsWith("application/json"))
    throw Error("JSON request required.");
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Error("Request too large.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}
export async function createBroadcastServer(options = {}) {
  const port = Number(
    options.port ?? process.env.PORT ?? process.env.DLAR_COLLECTOR_PORT ?? 8766,
  );
  const directory =
    options.directory ||
    process.env.DLAR_DATA_DIR ||
    path.join(root, ".dlar-cloud");
  const origin =
    options.origin ||
    process.env.PUBLIC_ORIGIN ||
    (process.env.RAILWAY_PUBLIC_DOMAIN
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
      : `http://127.0.0.1:${port}`);
  const hosted = Boolean(
    process.env.PORT ||
      process.env.RAILWAY_PROJECT_ID ||
      process.env.DLAR_CLOUD === "1" ||
      options.hosted,
  );
  const password = options.password ?? process.env.ADMIN_PASSWORD;
  const trusted = !hosted && !password;
  const store = new BroadcastDatabase(directory);
  await store.load();
  store.archive = new Archive(store);
  let auth;
  try {
    auth = new AdminAuth(
      store.db,
      password,
      origin.startsWith("https:"),
      trusted,
    );
  } catch (e) {
    store.close();
    throw e;
  }
  const catalog = JSON.parse(
    await readFile(new URL("./data/ultimates.json", import.meta.url), "utf8"),
  );
  const heroIds = new Set(
    JSON.parse(
      await readFile(new URL("../src/heroes.json", import.meta.url), "utf8"),
    ).map((h) => h.id),
  );
  const reportHeroes = JSON.parse(
    await readFile(new URL("../src/heroes.json", import.meta.url), "utf8"),
  );
  const reportItems = JSON.parse(
    await readFile(new URL("./data/items.json", import.meta.url), "utf8"),
  );
  const clients = new Set();
  let lastBroadcast = 0,
    pendingBroadcast = null;
  const session = () => {
    const s = store.sessions.get(store.workspace.deadem.id);
    return inTournament(s, store) ? s || null : null;
  };
  function output(channel) {
    const w = store.workspace,
      s = session();
    if (["hero-priority", "top-items", "series-mvp"].includes(channel))
      return {
        report: reportOutput(store, channel, reportHeroes, reportItems),
      };
    if (channel === "draft") return { config: w.config, draft: w.draft };
    if (channel === "match-overlay") return { overlay: resolveMatchOverlay(w) };
    if (channel === "live-events")
      return { config: w.config, apiStats: w.apiStats };
    if (channel === "scoreboard")
      return {
        visible: w.scoreboard.visible,
        scoreboard: inTournament(
          store.sessions.get(w.scoreboard.matchId),
          store,
        )
          ? store.sessions.get(w.scoreboard.matchId)?.published || null
          : null,
        kind: "scoreboard",
        mvp: w.scoreboard.mvp || null,
      };
    // Exclude archived/published copies and branding images from frequent live messages.
    const light = s
      ? {
          version: 1,
          id: s.id,
          mode: s.mode,
          status: s.status,
          match: s.result?.match || s.match,
          updatedAt: s.updatedAt,
          settings: s.settings,
          effects: channel === "ultimates" ? s.effects : [],
          recentHits: channel === "ultimates" ? s.recentHits : [],
          ended: Boolean(s.result),
        }
      : null;
    return {
      session: light,
      panel: {
        ...w.deadem.panel,
        names: s?.settings.names || {},
        teamNames: w.config.teams.map((t) => t.name),
      },
      visible: channel === "ultimates" ? w.deadem.hudVisible : w.deadem.visible,
    };
  }
  function send(client, data) {
    if (client.res.writableLength > 2000000) {
      client.res.destroy();
      return;
    }
    client.res.write(`data: ${JSON.stringify(data)}\n\n`);
  }
  function changed(section = "workspace") {
    for (const c of clients) {
      if (c.kind === "workspace" && section !== "collector")
        send(c, store.workspace);
      if (c.kind === "collector" && c.id === store.workspace.deadem.id)
        send(c, session());
      if (
        c.kind === "collector" &&
        section === "collector" &&
        c.id !== store.workspace.deadem.id
      )
        send(c, store.sessions.get(c.id) || null);
      if (c.kind !== "output") continue;
      const relevant =
        section === "workspace" ||
        (section === "draft" &&
          ["draft", "hero-priority", "match-overlay"].includes(c.channel)) ||
        (section === "reports" &&
          ["hero-priority", "top-items", "series-mvp"].includes(c.channel)) ||
        (section === "apiStats" && c.channel === "live-events") ||
        (section === "scoreboard" &&
          ["scoreboard", "match-overlay"].includes(c.channel)) ||
        (section === "collector" &&
          ["deadem", "ultimates"].includes(c.channel));
      if (relevant) send(c, output(c.channel));
    }
  }
  const collector = new CollectorEngine(store, () => {
    // Full player snapshots and hit notices share a bounded 10 Hz stream.
    if (Date.now() - lastBroadcast >= 100) {
      lastBroadcast = Date.now();
      changed("collector");
    } else if (!pendingBroadcast)
      pendingBroadcast = setTimeout(() => {
        pendingBroadcast = null;
        lastBroadcast = Date.now();
        changed("collector");
      }, 100);
  });
  const feeds = new SharedFeeds(store, changed);
  const publisher = new Publisher(store, changed, collector);
  const backups = new Backups(store);
  store.collector = collector;
  store.tournaments = new Tournaments(store, {
    busy: () =>
      Boolean(collector.worker) ||
      [...store.sessions.values()].some(
        (s) =>
          !s.result &&
          s.publisher?.lease &&
          Date.now() - s.publisher.lastSeen < 15000,
      ),
    stopFeeds: () => feeds.stop(),
  });
  function events(req, res, client, initial) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    });
    const c = { ...client, res };
    clients.add(c);
    send(c, initial);
    const beat = setInterval(() => {
      if (!res.destroyed) res.write(": heartbeat\n\n");
    }, 15000);
    beat.unref();
    res.on("close", () => {
      clearInterval(beat);
      clients.delete(c);
    });
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    try {
      const url = new URL(req.url, origin),
        method = req.method;
      const nativePublisher = [
        "/api/publisher/pair",
        "/api/publisher/begin",
        "/api/publisher/ingest",
      ].includes(url.pathname);
      if (
        ["POST", "PUT", "PATCH", "DELETE"].includes(method) &&
        req.headers.origin !== origin &&
        !(nativePublisher && !req.headers.origin)
      ) {
        json(res, 403, {
          error: "Open the admin dashboard on its configured website address.",
        });
        return;
      }
      if (url.pathname === "/healthz") {
        json(res, 200, { ok: true });
        return;
      }
      if (nativePublisher && method === "POST") {
        const p = url.pathname.endsWith("/pair")
          ? null
          : publisher.authenticate(req);
        const value = await body(req);
        const result = url.pathname.endsWith("/pair")
          ? publisher.pair(value, req.socket.remoteAddress)
          : url.pathname.endsWith("/begin")
            ? publisher.begin(p, value)
            : publisher.ingest(p, value);
        json(res, 200, result);
        return;
      }
      if (url.pathname === "/api/auth" && method === "GET") {
        json(res, 200, {
          cloud: true,
          authenticated: auth.authenticated(req),
          trustedLocal: trusted,
        });
        return;
      }
      if (url.pathname === "/api/login" && method === "POST") {
        const v = await body(req);
        auth.login(req, res, v.password);
        json(res, 200, { authenticated: true });
        return;
      }
      if (url.pathname === "/api/logout" && method === "POST") {
        await body(req);
        auth.logout(req, res);
        json(res, 200, { authenticated: false });
        return;
      }
      if (
        url.pathname === "/api/broadcast" ||
        url.pathname === "/api/broadcast/events"
      ) {
        const channel = url.searchParams.get("channel");
        if (method !== "GET" || !Object.hasOwn(OUTPUTS, channel)) {
          json(res, 404, { error: "Unknown broadcast output." });
          return;
        }
        if (url.pathname.endsWith("/events"))
          events(req, res, { kind: "output", channel }, output(channel));
        else json(res, 200, output(channel));
        return;
      }
      if (url.pathname.startsWith("/api/")) {
        if (!auth.authenticated(req)) {
          json(res, 401, { error: "Sign in to manage the shared broadcast." });
          return;
        }
        const scopedWrite =
          method === "POST" &&
          [
            "/api/workspace",
            "/api/tournaments/",
            "/api/data/",
            "/api/analytics/",
            "/api/collector/",
            "/api/draft/",
            "/api/live-events/",
          ].some((prefix) => url.pathname.startsWith(prefix));
        if (scopedWrite && !req.headers["x-dlar-tournament"])
          throw Object.assign(
            Error(
              "Refresh this dashboard to load the current tournament before making changes.",
            ),
            { status: 409 },
          );
        if (
          method === "POST" &&
          req.headers["x-dlar-tournament"] &&
          req.headers["x-dlar-tournament"] !==
            store.workspace.activeTournamentId
        )
          throw Object.assign(
            Error(
              "Another admin changed the tournament. Review the selected tournament before trying again.",
            ),
            { status: 409 },
          );
        if (url.pathname === "/api/tournaments" && method === "GET") {
          json(res, 200, {
            activeTournamentId: store.workspace.activeTournamentId,
            tournaments: store.workspace.tournaments,
          });
          return;
        }
        if (url.pathname === "/api/tournaments/create" && method === "POST") {
          const v = await body(req);
          store.tournaments.create(v.name);
          changed();
          json(res, 200, store.workspace);
          return;
        }
        if (url.pathname === "/api/tournaments/select" && method === "POST") {
          const v = await body(req);
          store.tournaments.select(v.id);
          changed();
          json(res, 200, store.workspace);
          return;
        }
        if (url.pathname === "/api/tournaments/rename" && method === "POST") {
          const v = await body(req);
          store.tournaments.rename(v.id, v.name);
          changed();
          json(res, 200, store.workspace);
          return;
        }
        if (url.pathname === "/api/data" && method === "GET") {
          json(res, 200, store.tournaments.summary());
          return;
        }
        if (
          ["/api/data/trash", "/api/data/restore", "/api/data/purge"].includes(
            url.pathname,
          ) &&
          method === "POST"
        ) {
          const v = await body(req);
          if (url.pathname.endsWith("/trash"))
            store.tournaments.trash(v.kind, v.ids);
          else if (url.pathname.endsWith("/restore"))
            store.tournaments.restore(v.id);
          else store.tournaments.purge(v.id, v.confirmation);
          changed();
          json(res, 200, store.tournaments.summary());
          return;
        }
        if (url.pathname === "/api/backups/delete" && method === "POST") {
          const v = await body(req);
          if (v.confirmation !== "DELETE")
            throw Error("Type DELETE to permanently remove a backup.");
          await backups.remove(v.name);
          json(res, 200, { files: await backups.list() });
          return;
        }
        if (url.pathname === "/api/backup" && method === "GET") {
          res.setHeader(
            "Content-Disposition",
            'attachment; filename="deadlock-ar-broadcast-backup.json"',
          );
          json(res, 200, exportBackup(store));
          return;
        }
        if (url.pathname === "/api/backups" && method === "GET") {
          json(res, 200, { files: await backups.list() });
          return;
        }
        if (url.pathname === "/api/backups/file" && method === "GET") {
          const name = url.searchParams.get("name"),
            data = await backups.read(name);
          res.writeHead(200, {
            "Content-Type": "application/gzip",
            "Content-Disposition": `attachment; filename="${name}"`,
          });
          res.end(data);
          return;
        }
        if (url.pathname === "/api/backup/restore" && method === "POST") {
          if (
            collector.worker ||
            [...store.sessions.values()].some(
              (s) =>
                !s.result &&
                s.publisher?.lease &&
                Date.now() - s.publisher.lastSeen < 15000,
            )
          )
            throw Error("Stop live collection before restoring a backup.");
          const prepared = prepareRestore(await body(req, 64000000), store);
          await backups.write();
          feeds.stop();
          store.db.exec("BEGIN IMMEDIATE");
          try {
            for (const s of prepared.sessions) {
              await store.save(s);
              store.db
                .prepare("DELETE FROM deleted_games WHERE id=?")
                .run(s.id);
            }
            for (const d of prepared.drafts)
              store.db
                .prepare("INSERT OR REPLACE INTO drafts VALUES (?,?)")
                .run(d.id, JSON.stringify(d));
            for (const r of prepared.tournaments) store.tournaments.put(r);
            for (const e of prepared.trash)
              store.db
                .prepare("INSERT OR REPLACE INTO trash VALUES (?,?)")
                .run(e.id, JSON.stringify(e));
            const restoredIds = new Set([
              ...store.sessions.keys(),
              ...prepared.sessions.map((s) => s.id),
            ]);
            for (const row of prepared.deletedGames)
              if (!restoredIds.has(row.id))
                store.db
                  .prepare(
                    "INSERT OR REPLACE INTO deleted_games VALUES (?,?,?)",
                  )
                  .run(row.id, row.tournamentId, row.deletedAt);
            store.write("workspace", prepared.workspace);
            store.db.exec("COMMIT");
          } catch (e) {
            store.db.exec("ROLLBACK");
            throw e;
          }
          for (const s of prepared.sessions) store.sessions.set(s.id, s);
          store.workspace = prepared.workspace;
          for (const r of prepared.tournaments)
            store.tournaments.records.set(r.id, r);
          store.tournaments.migrate();
          changed();
          json(res, 200, {
            restored: true,
            matches: prepared.sessions.length,
            drafts: prepared.drafts.length,
          });
          return;
        }
        if (url.pathname === "/api/publisher/status" && method === "GET") {
          json(res, 200, { publishers: publisher.list() });
          return;
        }
        if (url.pathname === "/api/publisher/code" && method === "POST") {
          json(res, 200, publisher.issue(await body(req)));
          return;
        }
        if (url.pathname === "/api/publisher/revoke" && method === "POST") {
          const v = await body(req);
          publisher.revoke(v.id);
          json(res, 200, { ok: true });
          return;
        }
        if (url.pathname === "/api/analytics" && method === "GET") {
          json(res, 200, {
            drafts: store.archive.list().filter((d) => inTournament(d, store)),
            games: [...store.sessions.values()]
              .filter((s) => inTournament(s, store))
              .filter((s) => s.items || s.result)
              .map((s) => ({
                id: s.id,
                label: s.label || s.id,
                tournament: s.tournament || s.published?.event || "",
                ended: Boolean(s.result),
                mode: s.mode,
                updatedAt: s.updatedAt,
                players: s.result?.match.players || [],
                purchases: [],
                ...s.items,
              })),
          });
          return;
        }
        if (url.pathname === "/api/analytics/mvp" && method === "POST") {
          const v = await body(req);
          if (!Array.isArray(v.ids) || !v.ids.length || v.ids.length > 100)
            throw Error("Choose completed games for this series.");
          const games = [...new Set(v.ids)].map((id) =>
            store.sessions.get(sessionId(id)),
          );
          if (
            games.some(
              (s) =>
                !s?.result ||
                !inTournament(s, store) ||
                s.mode === "rehearsal" ||
                s.mode === "replay",
            )
          )
            throw Error("Choose completed tournament games.");
          const appearances = games.flatMap((s) =>
            s.result.match.players.filter((p) => p.id === v.playerId),
          );
          if (!appearances.length)
            throw Error("Choose a player from these games.");
          const p = appearances[0],
            totals = Object.fromEntries(
              ["damage", "souls", "kills", "deaths", "assists"].map((k) => [
                k,
                appearances.every((p) => Number.isFinite(p[k]))
                  ? appearances.reduce((sum, p) => sum + p[k], 0)
                  : null,
              ]),
            );
          store.workspace.scoreboard.mvp = {
            player: {
              id: p.id,
              name: games[0].settings.names[p.id] || p.name,
              heroId: p.heroId,
              ...totals,
            },
            title: String(v.title || store.workspace.config.event).slice(0, 80),
            gameIds: games.map((s) => s.id),
            games: appearances.length,
            publishedAt: Date.now(),
          };
          store.workspace.reports.mvpPlayerId = v.playerId;
          store.workspace.reports.mvpSource = "recorded";
          store.workspace.reports.selectedGames = games.map((s) => s.id);
          store.workspace.reports.titles.mvp = String(v.title || "").slice(
            0,
            43,
          );
          store.workspace.scoreboard.kind = "scoreboard";
          store.workspace.revision++;
          store.saveWorkspace();
          changed("workspace");
          json(res, 200, { ok: true });
          return;
        }
        if (url.pathname === "/api/scoreboard/show" && method === "POST") {
          const v = await body(req);
          store.workspace.scoreboard.kind =
            v.kind === "mvp" ? "mvp" : "scoreboard";
          store.workspace.revision++;
          store.saveWorkspace();
          changed("scoreboard");
          json(res, 200, { ok: true });
          return;
        }
        if (url.pathname === "/api/analytics/draft" && method === "POST") {
          const v = await body(req);
          if (
            v.id &&
            !inTournament(
              store.archive.list().find((d) => d.id === v.id),
              store,
            )
          )
            throw Error("Choose a draft from the current tournament.");
          const result = v.id
            ? store.archive.update(v.id, v)
            : store.archive.capture({ force: true, label: v.label });
          store.saveWorkspace();
          json(res, 200, result);
          return;
        }
        if (url.pathname === "/api/analytics/review" && method === "POST") {
          const v = await body(req),
            s = store.sessions.get(sessionId(v.gameId));
          if (!s?.items) throw Error("Purchase history not found.");
          if (!inTournament(s, store))
            throw Error("Choose a game from the current tournament.");
          const row = s.items.purchases.find((p) => p.id === v.purchaseId);
          if (!row || !["confirmed", "refunded"].includes(v.status))
            throw Error("Choose a purchase and its result.");
          const correction = {
            status: v.status,
            evidence: "Operator review",
            reviewedAt: Date.now(),
          };
          Object.assign(row, correction);
          s.itemReviews = { ...s.itemReviews, [row.id]: correction };
          await store.save(s);
          changed("reports");
          json(res, 200, { ok: true });
          return;
        }
        if (url.pathname === "/api/workspace" && method === "GET") {
          json(res, 200, store.workspace);
          return;
        }
        if (url.pathname === "/api/workspace/events" && method === "GET") {
          events(req, res, { kind: "workspace" }, store.workspace);
          return;
        }
        if (url.pathname === "/api/workspace" && method === "POST") {
          const v = await body(req);
          if (
            v.tournamentId &&
            v.tournamentId !== store.workspace.activeTournamentId
          )
            throw Object.assign(
              Error("The tournament changed. Your edit was not applied."),
              { status: 409 },
            );
          if (!/^[a-f0-9-]{36}$/i.test(v.id || ""))
            throw Error("Invalid update identifier.");
          if (!store.hasPatch(v.id)) {
            const next = patchWorkspace(store.workspace, v.operations);
            if (next.deadem.id && !store.sessions.has(next.deadem.id))
              throw Error("Choose a saved or collected game.");
            if (
              next.deadem.id &&
              !inTournament(store.sessions.get(next.deadem.id), store)
            )
              throw Error("Choose a game from the current tournament.");
            store.applyPatch(v.id, next);
            store.archive.capture();
            store.saveWorkspace();
            changed();
          }
          json(res, 200, store.workspace);
          return;
        }
        if (url.pathname === "/api/draft/connect" && method === "POST") {
          feeds.connectDraft(await body(req));
          json(res, 200, store.workspace);
          return;
        }
        if (url.pathname === "/api/draft/rule" && method === "POST") {
          const v = await body(req),
            d = store.workspace.draft;
          if (d.mode === "live")
            throw Error(
              "A live room controls its own draft order. Disconnect it before choosing a manual format.",
            );
          if (![2, 3].includes(v.banCount))
            throw Error("Choose two or three bans.");
          store.archive.capture();
          d.archiveId = null;
          d.snapshot = blankDraft(v.banCount);
          store.workspace.revision++;
          store.saveWorkspace();
          changed("draft");
          json(res, 200, store.workspace);
          return;
        }
        if (url.pathname === "/api/draft/manual" && method === "POST") {
          const v = await body(req),
            draft = store.workspace.draft;
          if (draft.mode === "live")
            throw Error("Switch to manual mode before editing picks.");
          const step = draft.snapshot.steps.find((s) => s.id === v.stepId);
          if (!step || (v.heroId !== null && !heroIds.has(v.heroId)))
            throw Error("Choose a valid hero slot.");
          if (
            v.heroId &&
            draft.snapshot.steps.some(
              (s) => s.id !== step.id && s.heroId === v.heroId,
            )
          )
            throw Error("That hero is already selected.");
          step.heroId = v.heroId;
          store.archive.capture();
          store.workspace.revision++;
          store.saveWorkspace();
          changed("draft");
          json(res, 200, store.workspace);
          return;
        }
        if (url.pathname === "/api/live-events/start" && method === "POST") {
          feeds.startApi(await body(req));
          json(res, 200, store.workspace);
          return;
        }
        if (url.pathname === "/api/live-events/stop" && method === "POST") {
          await body(req);
          feeds.stopApi();
          json(res, 200, store.workspace);
          return;
        }
        if (url.pathname === "/api/collector/health") {
          json(res, 200, {
            version: 1,
            cloud: true,
            activeId: collector.activeId,
            running: Boolean(collector.worker),
            observer:
              publisher
                .list()
                .find(
                  (p) =>
                    p.activeGame === store.workspace.deadem.id && !p.revoked,
                ) || null,
            catalog,
            games: [...store.sessions.values()]
              .filter((s) => inTournament(s, store))
              .map((s) => ({
                id: s.id,
                status: s.status,
                mode: s.mode,
                published: Boolean(s.published),
                ended: Boolean(s.result),
              })),
          });
          return;
        }
        if (url.pathname === "/api/collector/start" && method === "POST") {
          if (
            [...store.sessions.values()].some(
              (s) =>
                !s.result &&
                s.publisher?.lease &&
                Date.now() - s.publisher.lastSeen < 15000,
            )
          )
            throw Error(
              "Disconnect the observer companion before starting a relay source.",
            );
          const v = await body(req),
            id = matchId(v.id),
            mode = v.mode === "replay" ? "replay" : "live";
          const s = collector.start({
            id,
            mode,
            broadcastUrl: broadcastUrl(v.broadcastUrl, id),
            replaySpeed: [1, 4, 16, 32].includes(Number(v.replaySpeed))
              ? Number(v.replaySpeed)
              : 16,
            replayFrom: Math.max(0, Math.min(7200, Number(v.replayFrom) || 0)),
          });
          store.workspace.deadem.id = id;
          store.workspace.revision++;
          store.saveWorkspace();
          changed();
          json(res, 200, s);
          return;
        }
        if (url.pathname === "/api/collector/stop" && method === "POST") {
          await body(req);
          await collector.stop();
          json(res, 200, { stopped: true });
          return;
        }
        const id = sessionId(url.searchParams.get("match")),
          s = store.sessions.get(id);
        if (!s) {
          json(res, 404, { error: "This game has not been collected." });
          return;
        }
        if (!inTournament(s, store))
          throw Error("Select this game’s tournament first.");
        if (url.pathname === "/api/collector/state" && method === "GET") {
          json(res, 200, s);
          return;
        }
        if (url.pathname === "/api/collector/events" && method === "GET") {
          events(req, res, { kind: "collector", id }, s);
          return;
        }
        if (url.pathname === "/api/collector/settings" && method === "POST") {
          const value = await body(req);
          s.settings = cleanSettings(
            value.operations
              ? applyOperations(s.settings, value.operations)
              : value,
            s.settings,
          );
          await store.save(s);
          changed("collector");
          json(res, 200, s);
          return;
        }
        if (url.pathname === "/api/collector/publish" && method === "POST") {
          const presentation = await body(req);
          const wasPublished = Boolean(s.published);
          publishResult(s, presentation);
          if (
            !wasPublished &&
            applySeriesWin(store, s, Number(presentation.winner))
          ) {
            s.published.teams = structuredClone(store.workspace.config.teams);
          }
          await store.save(s);
          store.workspace.scoreboard.matchId = id;
          store.workspace.scoreboard.kind = "scoreboard";
          store.workspace.revision++;
          store.saveWorkspace();
          changed("scoreboard");
          json(res, 200, s);
          return;
        }
        if (url.pathname === "/api/collector/verify" && method === "POST") {
          await body(req);
          const numericId =
            s.result?.match.matchId || (!id.startsWith("local-") ? id : null);
          if (!numericId || !/^\d{1,15}$/.test(numericId))
            throw Error(
              "This recording has no verified numeric match ID. Its captured final result is retained.",
            );
          if (!s.result)
            throw Error("Wait for a game-over signal before verifying.");
          const upstream = await fetch(
            `https://api.deadlock-api.com/v1/matches/${numericId}/metadata?is_custom=true`,
            { signal: AbortSignal.timeout(30000) },
          );
          if (!upstream.ok)
            throw Error(
              `Finished metadata unavailable (HTTP ${upstream.status}). Captured results retained.`,
            );
          const raw = await upstream.json(),
            normalized = normalizeMetadata(raw, numericId);
          const players = playersAt(normalized, normalized.duration).map(
            (p) => ({
              ...p,
              objectiveDamage:
                s.result.match.players.find((old) => old.id === p.id)
                  ?.objectiveDamage ?? null,
              items:
                s.result.match.players.find((old) => old.id === p.id)?.items ??
                null,
              abilities:
                s.result.match.players.find((old) => old.id === p.id)
                  ?.abilities ?? null,
              mvpRank:
                raw.match_info.players.find(
                  (old) => String(old.account_id) === p.id,
                )?.mvp_rank ?? null,
              name:
                s.match?.players.find((old) => old.id === p.id)?.name || p.name,
            }),
          );
          const ids = (p) =>
            p
              .map((v) => v.id)
              .sort()
              .join(",");
          if (ids(players) !== ids(s.result.match.players))
            throw Error("Metadata roster does not match the collected game.");
          const winner = raw.match_info?.winning_team;
          s.result = {
            ...s.result,
            match: {
              ...s.result.match,
              duration: normalized.duration,
              players,
              complete: true,
            },
            winner: [0, 1].includes(winner) ? winner : s.result.winner,
            verification: "metadata",
            mvpId: players.find((p) => p.mvpRank === 1)?.id || null,
            verifiedAt: Date.now(),
          };
          await store.save(s);
          changed("collector");
          json(res, 200, s);
          return;
        }
        json(res, 404, { error: "Unknown endpoint." });
        return;
      }
      if (method !== "GET" && method !== "HEAD") {
        res.writeHead(405).end();
        return;
      }
      const pathname = decodeURIComponent(url.pathname),
        base = options.staticDirectory || path.join(root, "dist");
      const spa = pathname === "/" || Object.values(OUTPUTS).includes(pathname);
      const target = path.resolve(base, "." + (spa ? "/index.html" : pathname));
      if (!target.startsWith(base + path.sep)) {
        res.writeHead(404).end();
        return;
      }
      const data = await readFile(target).catch(() => null);
      if (!data) {
        res.writeHead(404).end("Page not found.");
        return;
      }
      res.writeHead(200, {
        "Content-Type":
          types[path.extname(target)] || "application/octet-stream",
        "Cache-Control": pathname.startsWith("/assets/")
          ? "public, max-age=31536000, immutable"
          : "no-cache",
      });
      res.end(method === "HEAD" ? undefined : data);
    } catch (e) {
      if (!res.headersSent)
        json(res, e.status || 400, {
          error: e.message,
          ...(e.status === 409 ? { workspace: store.workspace } : {}),
        });
      else res.destroy();
    }
  });
  server.requestTimeout = 20000;
  const shutdown = async () => {
    backups.close();
    await backups.write();
    publisher.close();
    feeds.stop();
    await collector.stop();
    if (pendingBroadcast) clearTimeout(pendingBroadcast);
    store.saveWorkspace();
    for (const c of clients) c.res.destroy();
    await new Promise((resolve) => server.close(resolve));
    store.close();
  };
  return {
    server,
    store,
    collector,
    feeds,
    publisher,
    shutdown,
    origin,
    host: hosted ? "0.0.0.0" : "127.0.0.1",
    port,
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = await createBroadcastServer();
  app.server.listen(app.port, app.host, () =>
    console.log(
      `Deadlock AR Broadcast Studio listening on ${app.host}:${app.port}`,
    ),
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () => app.shutdown().then(() => process.exit(0)));
}

import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { collectLocal, saveJournal } from "../collector/local-reader.mjs";

const directory = path.resolve(
  process.env.DLAR_OBSERVER_DATA ||
    path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      ".dlar-observer",
    ),
);
await fs.mkdir(directory, { recursive: true });
const configFile = path.join(directory, "connection.json");
let config = JSON.parse(
  await fs.readFile(configFile, "utf8").catch(() => "{}"),
);
const save = () =>
  fs.writeFile(configFile, JSON.stringify(config, null, 2), { mode: 0o600 });
async function detectGame() {
  const roots = [
    "D:\\SteamLibrary",
    path.join(
      process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)",
      "Steam",
    ),
  ];
  if (process.platform === "win32") {
    try {
      const r = await promisify(execFile)(
        "reg.exe",
        ["query", "HKCU\\Software\\Valve\\Steam", "/v", "SteamPath"],
        { windowsHide: true },
      );
      const value = /SteamPath\s+REG_SZ\s+(.+)/.exec(r.stdout)?.[1]?.trim();
      if (value) roots.unshift(value);
    } catch {
      /* Folder entry remains available. */
    }
  }
  for (const root of [...roots]) {
    const vdf = await fs
      .readFile(path.join(root, "steamapps", "libraryfolders.vdf"), "utf8")
      .catch(() => "");
    for (const match of vdf.matchAll(/"path"\s+"([^"]+)"/g))
      roots.push(match[1].replaceAll("\\\\", "\\"));
  }
  for (const root of new Set(roots)) {
    const folder = path.join(
      root,
      "steamapps",
      "common",
      "Deadlock",
      "game",
      "citadel",
    );
    if (
      await fs
        .stat(folder)
        .then((s) => s.isDirectory())
        .catch(() => false)
    )
      return folder;
  }
  return "";
}
config.gameFolder ||= await detectGame();
const state = {
  version: "0.2.0",
  status: "Ready",
  paired: Boolean(config.token),
  studio: config.studio || "",
  gameFolder: config.gameFolder || "",
  run: null,
  error: "",
  data: null,
  connected: false,
};
let abort = null,
  latest = null,
  revision = 0,
  sent = 0,
  publishing = false,
  sequence = 0,
  lease = null,
  lastSent = 0;
let lastItemsRevision = -1,
  lastJournal = 0;
async function cloud(route, value, authenticated = true) {
  const response = await fetch(
    new URL(`/api/publisher/${route}`, config.studio),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authenticated ? { Authorization: `Bearer ${config.token}` } : {}),
      },
      body: JSON.stringify(value),
      signal: AbortSignal.timeout(10000),
    },
  );
  const data = await response.json();
  if (!response.ok)
    throw Object.assign(Error(data.error || `Studio HTTP ${response.status}`), {
      status: response.status,
    });
  return data;
}
async function connectRun(run) {
  const begun = await cloud("begin", {
    clientVersion: "0.2.0",
    id: run.id,
    recording: run.name,
    fromStart: run.fromStart,
    label: run.label,
  });
  lease = begun.lease;
  sequence = 0;
  revision = 0;
  sent = 0;
  latest = null;
  lastItemsRevision = -1;
  abort = new AbortController();
  state.run = run;
  state.error = "";
  state.status = "Waiting for the recording file";
  state.connected = true;
  config.lastRun = run;
  await save();
  collectLocal(
    { file: run.file, fromStart: run.fromStart },
    (value) => {
      latest = value.frame ? value : { ...latest, ...value };
      revision++;
      state.data = latest?.frame
        ? {
            clock: latest.frame.duration,
            players: latest.frame.players.length,
            bytes: latest.bytes,
            tick: latest.frame.tick,
            buffs: latest.frame.players.map((p) => ({
              name: p.name,
              permanent: p.buffs,
              bridge: p.bridgeBuffs,
            })),
          }
        : state.data;
      if (value.frame)
        state.status = value.frame.endObserved
          ? "Game ended — result saved to studio"
          : "Reading recording";
      if (value.stopped) {
        state.status = latest?.frame?.endObserved
          ? "Game ended — result saved to studio"
          : "Recording stopped";
        abort = null;
      }
    },
    abort.signal,
  ).catch((e) => {
    state.error = e.message;
    state.status = "Recording error";
    latest = { ...latest, stopped: true };
    revision++;
    abort = null;
  });
}
const timer = setInterval(async () => {
  if (
    publishing ||
    !lease ||
    (!latest && Date.now() - lastSent < 2000) ||
    (revision === sent && Date.now() - lastSent < 2000)
  )
    return;
  publishing = true;
  try {
    const snapshot = structuredClone(latest),
      version = revision;
    const packet = {
      id: state.run.id,
      lease,
      sequence: ++sequence,
      ...(version !== sent ? snapshot : {}),
    };
    if (packet.items && packet.items.revision === lastItemsRevision)
      delete packet.items;
    if (snapshot && (Date.now() - lastJournal > 2000 || snapshot.stopped)) {
      await saveJournal(path.join(directory, "runs", state.run.id), snapshot);
      lastJournal = Date.now();
    }
    const ack = await cloud("ingest", packet);
    if (ack.ack >= sequence) sent = version;
    if (packet.items && ack.ack >= sequence)
      lastItemsRevision = packet.items.revision;
    lastSent = Date.now();
    state.connected = true;
    state.error = "";
    if (snapshot?.stopped && sent === revision) lease = null;
  } catch (e) {
    state.connected = false;
    state.error = e.message;
    if ([401, 409].includes(e.status)) {
      abort?.abort();
      lease = null;
      state.status = "Reconnect required";
    }
  } finally {
    publishing = false;
  }
}, 500);
const html = await fs.readFile(new URL("./observer.html", import.meta.url));
let origin;
async function body(req) {
  let text = "";
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 8000) throw Error("Request too large.");
  }
  return JSON.parse(text || "{}");
}
const server = http.createServer(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  const json = (code, data) => {
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  };
  try {
    if (req.headers.host !== new URL(origin).host)
      return json(403, {
        error: "Use the companion address shown in its window.",
      });
    if (req.method === "GET" && req.url === "/") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(html);
      return;
    }
    if (req.method === "GET" && req.url === "/state") {
      json(200, {
        ...state,
        canResume: Boolean(config.lastRun),
        active: Boolean(abort),
      });
      return;
    }
    if (req.method !== "POST" || req.headers.origin !== origin)
      return json(403, { error: "Open the local companion page." });
    const value = await body(req);
    if (req.url === "/pair") {
      const url = new URL(value.studio);
      if (
        url.protocol !== "https:" &&
        !(
          url.protocol === "http:" &&
          ["127.0.0.1", "localhost"].includes(url.hostname)
        )
      )
        throw Error("Enter the HTTPS studio website address.");
      config.studio = url.origin;
      const result = await cloud("pair", { code: value.code }, false);
      config.token = result.token;
      config.publisherId = result.publisherId;
      await save();
      Object.assign(state, { studio: config.studio, paired: true, error: "" });
      json(200, { ok: true });
      return;
    }
    if (req.url === "/start" || req.url === "/resume") {
      if (abort || publishing)
        throw Error("Stop the current recording reader first.");
      if (!config.token)
        throw Error("Pair this computer with the studio first.");
      config.gameFolder = String(value.gameFolder || config.gameFolder || "");
      state.gameFolder = config.gameFolder;
      if (
        !(await fs
          .stat(config.gameFolder)
          .then((s) => s.isDirectory())
          .catch(() => false))
      )
        throw Error("Choose the Deadlock game/citadel folder.");
      const name = `dlar_${new Date().toISOString().replace(/\D/g, "")}`;
      const run =
        req.url === "/resume"
          ? config.lastRun
          : {
              id: `local-${randomUUID()}`,
              name,
              file: path.join(config.gameFolder, name + ".dem"),
              fromStart: value.fromStart === true,
              label: String(value.label || "").slice(0, 100),
            };
      if (!run) throw Error("No previous recording found.");
      if (req.url === "/start" && (await fs.stat(run.file).catch(() => null)))
        throw Error("Recording name already exists. Try again.");
      await connectRun(run);
      json(200, { command: `record ${run.name}`, run });
      return;
    }
    if (req.url === "/stop") {
      abort?.abort();
      json(200, { ok: true });
      return;
    }
    json(404, { error: "Unknown command." });
  } catch (e) {
    json(400, { error: e.message });
  }
});
await new Promise((resolve) =>
  server.listen(
    Number(process.env.DLAR_OBSERVER_PORT) || 0,
    "127.0.0.1",
    resolve,
  ),
);
origin = `http://127.0.0.1:${server.address().port}`;
console.log(
  `Deadlock AR Observer: ${origin}\nKeep this window open while recording. Credentials stay on this computer.`,
);
if (process.platform === "win32" && process.env.DLAR_NO_BROWSER !== "1")
  spawn("cmd.exe", ["/c", "start", "", origin], {
    windowsHide: true,
    stdio: "ignore",
  }).unref();
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    abort?.abort();
    clearInterval(timer);
    server.close();
    setTimeout(() => process.exit(0), 1000).unref();
  });

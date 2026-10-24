import {
  mkdir,
  readdir,
  readFile,
  writeFile,
  rename,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { cleanConfig, cleanSnapshot } from "../src/draft.js";
import { initialWorkspace } from "../src/workspace-model.js";
import { cleanPanel } from "../src/stats.js";
import { sessionId, cleanSettings, applyInterruption } from "./model.mjs";
import { cleanReportSettings } from "../src/analytics.js";

export function exportBackup(store) {
  store.tournaments?.saveActive();
  const matches = structuredClone([...store.sessions.values()]);
  for (const s of matches) delete s.publisher;
  return {
    version: 2,
    exportedAt: new Date().toISOString(),
    workspace: structuredClone(store.workspace),
    matches,
    drafts: store.archive.list(),
    tournaments: store.tournaments
      ? structuredClone([...store.tournaments.records.values()])
      : [],
    trash: store.tournaments?.listTrash() || [],
    deletedGames: store.tournaments
      ? store.db.prepare("SELECT * FROM deleted_games").all()
      : [],
  };
}
export function prepareRestore(value, store) {
  if (
    ![1, 2].includes(value?.version) ||
    !value.workspace ||
    !Array.isArray(value.matches) ||
    value.matches.length > 5000 ||
    !Array.isArray(value.drafts || []) ||
    (value.drafts || []).length > 5000
  )
    throw Error("Unsupported backup file.");
  const sessions = value.matches.map((raw) => {
    if (raw?.version !== 1) throw Error("Unsupported game in backup.");
    const s = structuredClone(raw);
    s.id = sessionId(s.id);
    s.settings = cleanSettings(s.settings);
    delete s.publisher;
    for (const match of [s.match, s.result?.match, s.published?.match].filter(
      Boolean,
    ))
      if (!Array.isArray(match.players) || match.players.length > 12)
        throw Error("Invalid roster in backup.");
    if (
      s.items &&
      (!Array.isArray(s.items.purchases) || s.items.purchases.length > 10000)
    )
      throw Error("Invalid purchase history in backup.");
    applyInterruption(
      s,
      "Restored from backup. Reconnect the companion to resume.",
    );
    return s;
  });
  const drafts = (value.drafts || []).map((raw) => {
    if (typeof raw.id !== "string" || raw.id.length > 250)
      throw Error("Invalid draft in backup.");
    return { ...raw, snapshot: cleanSnapshot(raw.snapshot) };
  });
  const w = initialWorkspace(),
    source = value.workspace;
  w.config = cleanConfig(source.config);
  w.reports = cleanReportSettings(source.reports);
  w.draft = {
    ...w.draft,
    mode: "manual",
    snapshot: cleanSnapshot(source.draft?.snapshot || w.draft.snapshot),
    archiveId: source.draft?.archiveId || null,
  };
  for (const k of ["deadem", "apiStats"]) {
    w[k].panel = cleanPanel(source[k]?.panel);
    w[k].visible = source[k]?.visible !== false;
  }
  const known = new Set([
    ...store.sessions.keys(),
    ...sessions.map((s) => s.id),
  ]);
  if (known.has(source.deadem?.id)) w.deadem.id = source.deadem.id;
  if (known.has(source.scoreboard?.matchId))
    w.scoreboard.matchId = source.scoreboard.matchId;
  w.scoreboard.visible = source.scoreboard?.visible !== false;
  w.revision = store.workspace.revision + 1;
  const context = {
    workspace: store.workspace,
    sessions: new Map([...known].map((id) => [id, {}])),
  };
  const tournament = (raw) => {
    if (
      !raw ||
      !/^[a-f0-9-]{36}$/i.test(raw.id || "") ||
      !String(raw.name || "").trim() ||
      !raw.state
    )
      throw Error("Invalid tournament in backup.");
    const state = prepareRestore(
      { version: 2, workspace: raw.state, matches: [], drafts: [] },
      context,
    ).workspace;
    return {
      id: raw.id,
      name: String(raw.name).trim().slice(0, 120),
      createdAt: Number(raw.createdAt) || Date.now(),
      state,
    };
  };
  if (
    !Array.isArray(value.tournaments || []) ||
    (value.tournaments || []).length > 5000 ||
    !Array.isArray(value.trash || []) ||
    (value.trash || []).length > 5000
  )
    throw Error("Invalid tournament archive in backup.");
  const tournaments = (value.tournaments || []).map(tournament);
  const trash = (value.trash || []).map((raw) => {
    if (
      !/^[a-f0-9-]{36}$/i.test(raw.id || "") ||
      !["game", "draft", "tournament"].includes(raw.kind)
    )
      throw Error("Invalid deleted record in backup.");
    const cleaned = prepareRestore(
      {
        version: 2,
        workspace: initialWorkspace(),
        matches: raw.kind === "game" ? [raw.record] : raw.games || [],
        drafts: raw.kind === "draft" ? [raw.record] : raw.drafts || [],
      },
      context,
    );
    return {
      id: raw.id,
      kind: raw.kind,
      label: String(raw.label || "").slice(0, 120),
      tournamentId: String(raw.tournamentId || ""),
      deletedAt: Number(raw.deletedAt) || Date.now(),
      record:
        raw.kind === "tournament"
          ? tournament(raw.record)
          : raw.kind === "game"
            ? cleaned.sessions[0]
            : cleaned.drafts[0],
      games: raw.kind === "tournament" ? cleaned.sessions : undefined,
      drafts: raw.kind === "tournament" ? cleaned.drafts : undefined,
    };
  });
  if (source.activeTournamentId)
    w.activeTournamentId = String(source.activeTournamentId);
  w.tournaments = tournaments.map(({ id, name, createdAt }) => ({
    id,
    name,
    createdAt,
  }));
  if (
    !Array.isArray(value.deletedGames || []) ||
    (value.deletedGames || []).length > 50000
  )
    throw Error("Invalid deleted game index in backup.");
  const deletedGames = (value.deletedGames || []).map((row) => ({
    id: sessionId(row.id),
    tournamentId: String(row.tournamentId || "").slice(0, 100),
    deletedAt: Number(row.deletedAt) || Date.now(),
  }));
  return { sessions, drafts, workspace: w, tournaments, trash, deletedGames };
}
export class Backups {
  constructor(store) {
    this.store = store;
    this.directory = path.join(store.directory, "backups");
    this.busy = false;
    this.timer = setInterval(
      () =>
        this.write().catch((e) =>
          console.error("Automatic backup failed:", e.message),
        ),
      60000,
    );
    this.timer.unref();
  }
  async list() {
    await mkdir(this.directory, { recursive: true });
    return (await readdir(this.directory))
      .filter((n) => /^studio-\d{4}-\d\d-\d\d\.json\.gz$/.test(n))
      .sort()
      .reverse();
  }
  async write() {
    if (this.busy) return;
    this.busy = true;
    try {
      await mkdir(this.directory, { recursive: true });
      const name = `studio-${new Date().toISOString().slice(0, 10)}.json.gz`,
        target = path.join(this.directory, name);
      await writeFile(
        target + ".tmp",
        gzipSync(JSON.stringify(exportBackup(this.store))),
        { mode: 0o600 },
      );
      await rename(target + ".tmp", target);
      for (const old of (await this.list()).slice(14))
        await unlink(path.join(this.directory, old));
    } finally {
      this.busy = false;
    }
  }
  async read(name) {
    if (!(await this.list()).includes(name)) throw Error("Backup not found.");
    return readFile(path.join(this.directory, name));
  }
  async remove(name) {
    if (!(await this.list()).includes(name)) throw Error("Backup not found.");
    await unlink(path.join(this.directory, name));
  }
  close() {
    clearInterval(this.timer);
  }
}

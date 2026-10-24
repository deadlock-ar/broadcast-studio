import { DatabaseSync } from "node:sqlite";
import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { applyInterruption, matchId, sessionId } from "./model.mjs";
import { initialWorkspace } from "../src/workspace-model.js";

export class BroadcastDatabase {
  constructor(directory) {
    this.directory = directory;
    this.sessions = new Map();
  }
  async load() {
    await mkdir(this.directory, { recursive: true });
    this.db = new DatabaseSync(path.join(this.directory, "broadcast.sqlite"));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS matches (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS logins (hash TEXT PRIMARY KEY, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS patches (id TEXT PRIMARY KEY, created INTEGER NOT NULL);`);
    const rows = this.db.prepare("SELECT value FROM matches").all();
    for (const row of rows) this.restore(JSON.parse(row.value));
    // Import earlier local captures once, preserving the originals as recovery copies.
    for (const file of await readdir(this.directory)) {
      if (!/^\d+\.json$/.test(file) || this.sessions.has(file.slice(0, -5)))
        continue;
      try {
        const s = JSON.parse(
          await readFile(path.join(this.directory, file), "utf8"),
        );
        if (s.version === 1 && matchId(s.id) === file.slice(0, -5)) {
          this.restore(s);
          await this.save(s);
        }
      } catch {
        /* An unreadable legacy archive is retained. */
      }
    }
    this.workspace = this.read("workspace") || initialWorkspace();
    this.workspace.reports ||= initialWorkspace().reports;
    this.workspace.draft.status = {
      state: "idle",
      message: this.workspace.draft.code
        ? "Saved draft retained. Reconnect to resume live updates."
        : "Shared workspace ready.",
    };
    if (this.workspace.apiStats.source?.mode === "live") {
      this.workspace.apiStats.result.status = "disconnected";
      this.workspace.apiStats.result.message =
        "Service restarted. Reconnect the API feed.";
    }
    this.write("workspace", this.workspace);
  }
  restore(s) {
    s.effects = [];
    s.recentHits = [];
    applyInterruption(s, "Service restarted · reconnect to resume this game.");
    this.sessions.set(s.id, s);
  }
  async save(s) {
    this.db
      .prepare("INSERT OR REPLACE INTO matches VALUES (?,?)")
      .run(sessionId(s.id), JSON.stringify(s));
  }
  read(key) {
    const row = this.db
      .prepare("SELECT value FROM settings WHERE key=?")
      .get(key);
    return row ? JSON.parse(row.value) : null;
  }
  write(key, value) {
    this.db
      .prepare("INSERT OR REPLACE INTO settings VALUES (?,?)")
      .run(key, JSON.stringify(value));
  }
  saveWorkspace() {
    this.write("workspace", this.workspace);
    this.tournaments?.saveActive();
  }
  hasPatch(id) {
    return Boolean(
      this.db.prepare("SELECT id FROM patches WHERE id=?").get(id),
    );
  }
  applyPatch(id, next) {
    if (this.hasPatch(id)) return;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.write("workspace", next);
      const tournament = this.tournaments?.records.get(next.activeTournamentId);
      if (tournament) {
        const current = this.workspace;
        this.workspace = next;
        try {
          this.tournaments.saveActive();
        } finally {
          this.workspace = current;
        }
      }
      this.db.prepare("INSERT INTO patches VALUES (?,?)").run(id, Date.now());
      this.db
        .prepare("DELETE FROM patches WHERE created < ?")
        .run(Date.now() - 86400000);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    // Preserve section identities held by the two running feed connections.
    for (const key of [
      "config",
      "draft",
      "apiStats",
      "deadem",
      "scoreboard",
      "reports",
    ])
      Object.assign(this.workspace[key], next[key]);
    this.workspace.revision = next.revision;
  }
  close() {
    this.db.close();
  }
}

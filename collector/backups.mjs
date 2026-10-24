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
  const matches = structuredClone([...store.sessions.values()]);
  for (const s of matches) delete s.publisher;
  return {
    version: 2,
    exportedAt: new Date().toISOString(),
    workspace: structuredClone(store.workspace),
    matches,
    drafts: store.archive.list(),
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
  return { sessions, drafts, workspace: w };
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
  close() {
    clearInterval(this.timer);
  }
}

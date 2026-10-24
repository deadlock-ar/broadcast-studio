import { randomUUID } from "node:crypto";
import { draftSelections, DRAFT_RULE } from "../src/analytics.js";

export class Archive {
  constructor(store) {
    this.store = store;
    store.db.exec(
      "CREATE TABLE IF NOT EXISTS drafts (id TEXT PRIMARY KEY, value TEXT NOT NULL)",
    );
  }
  list() {
    return this.store.db
      .prepare("SELECT value FROM drafts ORDER BY rowid DESC")
      .all()
      .map((r) => JSON.parse(r.value));
  }
  capture({ force = false, newDraft = false, label } = {}) {
    const w = this.store.workspace,
      d = w.draft;
    if (d.mode === "demo" && !force) return null;
    if (!d.snapshot?.steps.some((s) => s.heroId)) return null;
    let id = d.archiveId;
    // Live draft code is stable across reconnects and service restarts.
    if (d.mode === "live") id = `statlocker:${d.code}`;
    else if (!id || newDraft) id = `manual:${randomUUID()}`;
    const old = this.store.db
      .prepare("SELECT value FROM drafts WHERE id=?")
      .get(id);
    const previous = old ? JSON.parse(old.value) : {};
    const record = {
      ...previous,
      id,
      source: d.mode,
      code: d.code,
      rule:
        d.snapshot.steps.filter((s) => s.selectionType === "ban").length === 6
          ? DRAFT_RULE
          : "source-order",
      label: String(
        label || previous.label || `${w.config.round} · Game ${w.config.game}`,
      ).slice(0, 120),
      tournament: previous.tournament || w.config.event,
      config: structuredClone(w.config),
      snapshot: structuredClone(d.snapshot),
      selections: draftSelections(d.snapshot),
      completed:
        d.snapshot.status === "COMPLETED" ||
        d.snapshot.steps.every((s) => s.heroId),
      createdAt: previous.createdAt || Date.now(),
      updatedAt: Date.now(),
    };
    this.store.db
      .prepare("INSERT OR REPLACE INTO drafts VALUES (?,?)")
      .run(id, JSON.stringify(record));
    d.archiveId = id;
    return record;
  }
  update(id, value) {
    const current = this.list().find((d) => d.id === id);
    if (!current) throw Error("Draft not found.");
    for (const key of ["label", "tournament"])
      if (typeof value[key] === "string")
        current[key] = value[key].slice(0, 120);
    if (typeof value.excluded === "boolean") current.excluded = value.excluded;
    this.store.db
      .prepare("UPDATE drafts SET value=? WHERE id=?")
      .run(JSON.stringify(current), id);
    return current;
  }
}

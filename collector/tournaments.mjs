import { randomUUID } from "node:crypto";
import { initialWorkspace } from "../src/workspace-model.js";
import { cleanMatchOverlay } from "../src/match-overlay.js";
import { cleanBracket } from "../src/bracket.js";
import { prepareTournamentBracket } from "./bracket-service.mjs";

const sections = [
  "config",
  "draft",
  "reports",
  "deadem",
  "scoreboard",
  "apiStats",
  "matchOverlay",
  "bracket",
];
export const inTournament = (record, store) =>
  !store.workspace.activeTournamentId ||
  record?.tournamentId === store.workspace.activeTournamentId;
const stateOf = (workspace) =>
  structuredClone(Object.fromEntries(sections.map((k) => [k, workspace[k]])));
const nameOf = (value) => {
  const name = String(value || "")
    .trim()
    .slice(0, 120);
  if (!name) throw Error("Enter a tournament name.");
  return name;
};

export class Tournaments {
  constructor(store, { busy = () => false, stopFeeds = () => {} } = {}) {
    Object.assign(this, { store, busy, stopFeeds });
    store.db.exec(
      "CREATE TABLE IF NOT EXISTS tournaments (id TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS trash (id TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS deleted_games (id TEXT PRIMARY KEY, tournamentId TEXT, deletedAt INTEGER);",
    );
    this.records = new Map(
      store.db
        .prepare("SELECT value FROM tournaments")
        .all()
        .map((row) => {
          const r = JSON.parse(row.value);
          r.state.matchOverlay = cleanMatchOverlay(r.state.matchOverlay);
          r.state.bracket = cleanBracket(r.state.bracket);
          return [r.id, r];
        }),
    );
    for (const record of this.records.values()) this.put(record);
    this.migrate();
  }
  put(record) {
    record.state.matchOverlay = cleanMatchOverlay(record.state.matchOverlay);
    record.state.bracket = cleanBracket(record.state.bracket);
    this.store.db
      .prepare("INSERT OR REPLACE INTO tournaments VALUES (?,?)")
      .run(record.id, JSON.stringify(record));
  }
  index() {
    this.store.workspace.tournaments = [...this.records.values()].map(
      ({ id, name, createdAt }) => ({ id, name, createdAt }),
    );
  }
  saveActive() {
    const r = this.records.get(this.store.workspace.activeTournamentId);
    if (r) {
      r.state = stateOf(this.store.workspace);
      this.put(r);
    }
  }
  migrate() {
    const w = this.store.workspace,
      fallback = w.config.event || "Community tournament";
    const byName = new Map([...this.records.values()].map((r) => [r.name, r]));
    const ensure = (name) => {
      name = String(name || fallback).trim() || fallback;
      if (!byName.has(name)) {
        const state = initialWorkspace();
        state.config.event = name;
        const r = {
          id: randomUUID(),
          name,
          createdAt: Date.now(),
          state: stateOf(state),
        };
        this.records.set(r.id, r);
        byName.set(name, r);
        this.put(r);
      }
      return byName.get(name);
    };
    if (!this.records.has(w.activeTournamentId)) {
      const current = ensure(fallback);
      w.activeTournamentId = current.id;
      current.state = stateOf(w);
      this.put(current);
    }
    for (const s of this.store.sessions.values())
      if (!this.records.has(s.tournamentId)) {
        s.tournamentId = ensure(s.tournament || s.published?.event).id;
        this.store.save(s);
      }
    for (const d of this.store.archive.list())
      if (!this.records.has(d.tournamentId)) {
        d.tournamentId = ensure(d.tournament).id;
        this.store.db
          .prepare("UPDATE drafts SET value=? WHERE id=?")
          .run(JSON.stringify(d), d.id);
      }
    this.index();
    if (
      w.deadem.id &&
      !inTournament(this.store.sessions.get(w.deadem.id), this.store)
    )
      w.deadem.id = "";
    if (
      w.scoreboard.matchId &&
      !inTournament(this.store.sessions.get(w.scoreboard.matchId), this.store)
    )
      w.scoreboard.matchId = "";
    for (const key of ["selectedGames", "comparisonGames"])
      w.reports[key] = w.reports[key].filter((id) =>
        inTournament(this.store.sessions.get(id), this.store),
      );
    const drafts = this.store.archive.list();
    w.reports.selectedDrafts = w.reports.selectedDrafts.filter((id) =>
      inTournament(
        drafts.find((d) => d.id === id),
        this.store,
      ),
    );
    this.store.saveWorkspace();
  }
  assertIdle() {
    if (this.busy())
      throw Object.assign(
        Error(
          "Stop the observer recording or relay collection before changing tournaments.",
        ),
        { status: 409 },
      );
  }
  create(options) {
    this.assertIdle();
    if (typeof options === "string") options = { name: options };
    let name = nameOf(options?.name);
    if (
      [...this.records.values()].some(
        (r) => r.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
      )
    )
      throw Error(
        "A tournament with this name already exists. Select it instead.",
      );
    const state = initialWorkspace();
    state.config.event = name;
    state.bracket = prepareTournamentBracket(options, this.store.rosterLibrary);
    const r = {
      id: randomUUID(),
      name,
      createdAt: Date.now(),
      state: stateOf(state),
    };
    this.records.set(r.id, r);
    this.put(r);
    this.index();
    this.store.saveWorkspace();
    this.select(r.id);
    return r;
  }
  select(id) {
    const r = this.records.get(id);
    if (!r) throw Error("Tournament not found.");
    if (id === this.store.workspace.activeTournamentId) return;
    this.assertIdle();
    this.store.archive.capture();
    this.stopFeeds();
    this.saveActive();
    const w = this.store.workspace;
    for (const key of sections)
      w[key] = structuredClone(r.state[key] || initialWorkspace()[key]);
    w.matchOverlay = cleanMatchOverlay(w.matchOverlay);
    w.bracket = cleanBracket(w.bracket);
    w.activeTournamentId = id;
    w.revision++;
    w.draft.status = {
      state: "idle",
      message: "Tournament loaded. Reconnect its live draft when ready.",
    };
    w.apiStats.source = null;
    if (w.apiStats.result?.status === "live")
      w.apiStats.result.status = "disconnected";
    this.index();
    this.store.saveWorkspace();
  }
  rename(id, name) {
    const r = this.records.get(id);
    if (!r) throw Error("Tournament not found.");
    name = nameOf(name);
    if (
      [...this.records.values()].some(
        (other) =>
          other.id !== id &&
          other.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
      )
    )
      throw Error("Choose a different tournament name.");
    r.name = name;
    this.put(r);
    this.index();
    this.store.workspace.revision++;
    this.store.saveWorkspace();
  }
  listTrash() {
    return this.store.db
      .prepare("SELECT value FROM trash ORDER BY rowid DESC")
      .all()
      .map((row) => JSON.parse(row.value));
  }
  isDeleted(id) {
    return Boolean(
      this.store.db.prepare("SELECT id FROM deleted_games WHERE id=?").get(id),
    );
  }
  summary() {
    return {
      tournaments: [...this.records.values()].map(({ id, name }) => ({
        id,
        name,
        active: id === this.store.workspace.activeTournamentId,
      })),
      games: [...this.store.sessions.values()].map((s) => ({
        id: s.id,
        tournamentId: s.tournamentId,
        label: s.label || s.id,
        status: s.status,
        published: Boolean(s.published),
        items: s.items?.purchases.length || 0,
        updatedAt: s.updatedAt,
      })),
      drafts: this.store.archive.list().map((d) => ({
        id: d.id,
        tournamentId: d.tournamentId,
        label: d.label,
        selections: d.selections?.filter((s) => s.heroId).length || 0,
        updatedAt: d.updatedAt,
      })),
      trash: this.listTrash().map(
        ({ id, kind, label, deletedAt, tournamentId }) => ({
          id,
          kind,
          label,
          deletedAt,
          tournamentId,
        }),
      ),
    };
  }
  trash(kind, ids) {
    if (!Array.isArray(ids) || !ids.length || ids.length > 500)
      throw Error("Select records to delete.");
    const entries = [];
    for (const id of new Set(ids)) {
      if (kind === "tournament") {
        if (id === this.store.workspace.activeTournamentId)
          throw Error("Select another tournament before deleting this one.");
        const r = this.records.get(id);
        if (!r) throw Error("Tournament not found.");
        const games = [...this.store.sessions.values()].filter(
            (s) => s.tournamentId === id,
          ),
          drafts = this.store.archive
            .list()
            .filter((d) => d.tournamentId === id);
        entries.push({
          id: randomUUID(),
          kind,
          label: r.name,
          tournamentId: id,
          record: structuredClone(r),
          games: structuredClone(games),
          drafts,
          deletedAt: Date.now(),
        });
      } else if (kind === "game" || kind === "draft") {
        const record =
          kind === "game"
            ? this.store.sessions.get(id)
            : this.store.archive.list().find((d) => d.id === id);
        if (!record) throw Error("Record not found.");
        if (
          kind === "game" &&
          ((!record.result &&
            record.publisher?.lease &&
            Date.now() - record.publisher.lastSeen < 15000) ||
            (this.store.collector?.activeId === id &&
              this.store.collector.worker))
        )
          throw Error("Stop this game's collection before deleting it.");
        if (
          kind === "draft" &&
          this.store.workspace.draft.archiveId === id &&
          this.store.workspace.draft.mode === "live"
        )
          throw Error("Disconnect this live draft before deleting it.");
        entries.push({
          id: randomUUID(),
          kind,
          label: record.label || record.id,
          tournamentId: record.tournamentId,
          record: structuredClone(record),
          deletedAt: Date.now(),
        });
      } else throw Error("Choose games, drafts or tournaments.");
    }
    const w = structuredClone(this.store.workspace),
      records = structuredClone([...this.records]);
    const removedGames = new Set(
        entries.flatMap((e) =>
          e.kind === "game" ? [e.record.id] : (e.games || []).map((s) => s.id),
        ),
      ),
      removedDrafts = new Set(
        entries.flatMap((e) =>
          e.kind === "draft"
            ? [e.record.id]
            : (e.drafts || []).map((d) => d.id),
        ),
      );
    this.store.db.exec("BEGIN IMMEDIATE");
    try {
      for (const e of entries) {
        if (e.record?.publisher) delete e.record.publisher;
        for (const game of e.games || []) delete game.publisher;
        this.store.db
          .prepare("INSERT INTO trash VALUES (?,?)")
          .run(e.id, JSON.stringify(e));
        if (e.kind === "tournament") {
          this.records.delete(e.record.id);
          this.store.db
            .prepare("DELETE FROM tournaments WHERE id=?")
            .run(e.record.id);
        }
      }
      for (const id of removedGames) {
        this.store.db
          .prepare("INSERT OR REPLACE INTO deleted_games VALUES (?,?,?)")
          .run(id, this.store.sessions.get(id)?.tournamentId || "", Date.now());
        this.store.db.prepare("DELETE FROM matches WHERE id=?").run(id);
      }
      for (const id of removedDrafts)
        this.store.db.prepare("DELETE FROM drafts WHERE id=?").run(id);
      const clean = (state) => {
        if (removedGames.has(state.deadem.id)) state.deadem.id = "";
        if (removedGames.has(state.scoreboard.matchId))
          state.scoreboard.matchId = "";
        if (removedDrafts.has(state.draft.archiveId)) {
          state.draft.archiveId = null;
          state.draft.snapshot = initialWorkspace().draft.snapshot;
        }
        for (const key of ["selectedGames", "comparisonGames"])
          state.reports[key] = state.reports[key].filter(
            (id) => !removedGames.has(id),
          );
        state.reports.selectedDrafts = state.reports.selectedDrafts.filter(
          (id) => !removedDrafts.has(id),
        );
      };
      for (const r of this.records.values()) {
        clean(r.state);
        this.put(r);
      }
      clean(this.store.workspace);
      this.index();
      this.store.workspace.revision++;
      this.store.saveWorkspace();
      this.store.db.exec("COMMIT");
      for (const id of removedGames) this.store.sessions.delete(id);
    } catch (e) {
      this.store.db.exec("ROLLBACK");
      this.store.workspace = w;
      this.records = new Map(records);
      throw e;
    }
  }
  restore(id) {
    const e = this.listTrash().find((e) => e.id === id);
    if (!e) throw Error("Deleted record not found.");
    if (e.kind !== "tournament" && !this.records.has(e.tournamentId))
      throw Error("Restore its tournament first.");
    const games = e.kind === "game" ? [e.record] : e.games || [],
      drafts = e.kind === "draft" ? [e.record] : e.drafts || [];
    if (
      games.some((s) => this.store.sessions.has(s.id)) ||
      drafts.some((d) =>
        this.store.archive.list().some((old) => old.id === d.id),
      ) ||
      (e.kind === "tournament" && this.records.has(e.record.id))
    )
      throw Error("A record with this identity already exists.");
    this.store.db.exec("BEGIN IMMEDIATE");
    try {
      if (e.kind === "tournament") this.put(e.record);
      for (const s of games) {
        delete s.publisher;
        this.store.db.prepare("DELETE FROM deleted_games WHERE id=?").run(s.id);
        this.store.db
          .prepare("INSERT INTO matches VALUES (?,?)")
          .run(s.id, JSON.stringify(s));
      }
      for (const d of drafts)
        this.store.db
          .prepare("INSERT INTO drafts VALUES (?,?)")
          .run(d.id, JSON.stringify(d));
      this.store.db.prepare("DELETE FROM trash WHERE id=?").run(id);
      this.store.db.exec("COMMIT");
    } catch (err) {
      this.store.db.exec("ROLLBACK");
      throw err;
    }
    if (e.kind === "tournament") this.records.set(e.record.id, e.record);
    for (const s of games) this.store.restore(s);
    this.index();
    this.store.workspace.revision++;
    this.store.saveWorkspace();
  }
  purge(id, confirmation) {
    if (confirmation !== "DELETE")
      throw Error("Type DELETE to permanently remove this record.");
    if (!this.listTrash().some((e) => e.id === id))
      throw Error("Deleted record not found.");
    this.store.db.prepare("DELETE FROM trash WHERE id=?").run(id);
  }
}

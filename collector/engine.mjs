import { Worker } from "node:worker_threads";
import {
  emptySession,
  applyFrame,
  applyInterruption,
  matchId,
} from "./model.mjs";
export class CollectorEngine {
  constructor(store, changed) {
    this.store = store;
    this.changed = changed;
    this.worker = null;
    this.activeId = null;
    this.savedAt = 0;
  }
  start(options) {
    const id = matchId(options.id),
      prior = this.store.sessions.get(id);
    if (this.store.tournaments?.isDeleted(id))
      throw Error(
        "This game was deleted. Restore it from Trash before collecting it again.",
      );
    if (
      prior?.tournamentId &&
      prior.tournamentId !== this.store.workspace.activeTournamentId
    )
      throw Error("Select this game's tournament before collecting it.");
    if (this.worker)
      throw Error(
        "Stop the current Deadem collector before starting another game.",
      );
    if (
      prior?.result &&
      !(options.mode === "replay" && prior.mode === "replay")
    )
      throw Error("This result is already saved. Select it from Saved games.");
    const state = prior?.result
      ? {
          ...emptySession(id, options.mode),
          settings: prior.settings,
          published: prior.published,
        }
      : prior || emptySession(id, options.mode);
    Object.assign(state, {
      tournamentId: this.store.workspace.activeTournamentId,
      tournament: state.tournament || this.store.workspace.config.event,
      mode: options.mode,
      status: "connecting",
      effects: [],
      recentHits: [],
    });
    this.store.sessions.set(id, state);
    this.activeId = id;
    const worker = new Worker(new URL("./worker.mjs", import.meta.url), {
      workerData: options,
    });
    this.worker = worker;
    const save = () =>
      this.store
        .save(state)
        .then(() => {
          state.storageError = false;
        })
        .catch(() => {
          state.storageError = true;
          this.changed(id);
        });
    worker.on("message", (msg) => {
      if (this.worker !== worker) return;
      if (msg.type === "frame") {
        applyFrame(state, msg.frame);
        if (!state.result) state.effects = msg.effects;
      }
      if (msg.type === "hit" && !state.result)
        state.recentHits = [
          ...state.recentHits.filter((h) => Date.now() - h.at < 5000),
          { ...msg.hit, at: Date.now() },
        ].slice(-40);
      if (msg.type === "status" && !state.result)
        Object.assign(state, {
          status: msg.status,
          message: msg.message,
          effects: [],
          recentHits: [],
        });
      if (msg.type === "ended") {
        state.effects = [];
        state.recentHits = [];
      }
      this.changed(id);
      if (state.result || Date.now() - this.savedAt > 2000) {
        this.savedAt = Date.now();
        save();
      }
    });
    worker.on("error", (e) => {
      applyInterruption(state, `Collector error: ${e.message}`);
      save();
      this.changed(id);
    });
    worker.on("exit", () => {
      if (this.worker !== worker) return;
      this.worker = null;
      applyInterruption(
        state,
        state.message || "Collector stopped before game end.",
      );
      save();
      this.changed(id);
    });
    save();
    this.changed(id);
    return state;
  }
  async stop() {
    const worker = this.worker;
    this.worker = null;
    if (worker) await worker.terminate();
    const s = this.store.sessions.get(this.activeId);
    if (s) {
      applyInterruption(
        s,
        "Stopped by admin · last values saved; no game-over signal assumed.",
      );
      await this.store.save(s);
      this.changed(s.id);
    }
  }
}

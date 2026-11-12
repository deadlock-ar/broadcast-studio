import { openDraftConnection, parseDraftCode, makeDemo } from "../src/draft.js";
import { blankDraft } from "../src/workspace-model.js";
import {
  parseMatchId,
  loadFinishedMatch,
  loadStatHeroes,
  streamLiveMatch,
  reduceLiveRow,
  livePlayers,
  liveFeedMessage,
} from "../src/stats.js";

export class SharedFeeds {
  constructor(store, changed) {
    this.store = store;
    this.changed = changed;
    this.draft = null;
    this.api = null;
    this.apiSavedAt = 0;
  }
  update(section, durable = true) {
    if (durable) this.store.saveWorkspace();
    this.changed(section);
  }
  connectDraft(value) {
    const d = this.store.workspace.draft,
      mode = value.mode,
      banCount = d.snapshot.banCount || 3;
    if (!["live", "manual", "demo"].includes(mode))
      throw Error("Choose a draft source.");
    const selectedCode =
      mode === "live" ? parseDraftCode(value.code || "") : "";
    this.draft?.();
    this.draft = null;
    this.store.archive?.capture();
    if (mode !== "live" && (value.newDraft || d.mode !== mode))
      d.archiveId = null;
    if (mode === "live") {
      const code = selectedCode;
      if (d.code !== code) d.snapshot = blankDraft();
      Object.assign(d, { mode, code });
      this.draft = openDraftConnection(
        code,
        {
          onStatus: (status) => {
            d.status = status;
            this.update("draft");
          },
          onSnapshot: (snapshot) => {
            d.snapshot = snapshot;
            this.store.archive?.capture();
            this.update("draft");
            if (snapshot.status === "COMPLETED")
              queueMicrotask(() => {
                this.draft?.();
                this.draft = null;
              });
          },
          onTimer: (timer) => {
            d.snapshot.currentTimer = { ...d.snapshot.currentTimer, ...timer };
            this.update("draft", false);
          },
          onNotice: (message) => {
            d.status.message = message;
            this.update("draft", false);
          },
        },
        { password: String(value.password || "").slice(0, 256) },
      );
    } else {
      if (mode === "demo") d.snapshot = makeDemo(banCount);
      else if (value.newDraft) d.snapshot = blankDraft(banCount);
      else if (d.mode === "demo") d.snapshot = blankDraft(banCount);
      else d.snapshot = { ...d.snapshot, draftCode: "", status: "WAITING" };
      Object.assign(d, {
        mode,
        code: "",
        status: {
          state: "idle",
          message:
            mode === "demo"
              ? "Shared rehearsal · changes appear in the draft OBS source."
              : "Shared manual draft.",
        },
      });
    }
    this.store.workspace.revision++;
    this.update("workspace");
  }
  startApi(value) {
    const id = parseMatchId(value.id),
      mode = value.mode === "live" ? "live" : "finished";
    this.api?.abort();
    const abort = new AbortController();
    this.api = abort;
    const a = this.store.workspace.apiStats;
    a.source = { id, mode };
    a.time = null;
    a.result = {
      match: null,
      status: "loading",
      message:
        mode === "live"
          ? "Connecting to Deadlock API live events…"
          : "Loading finished match…",
      updated: null,
    };
    this.store.workspace.revision++;
    this.update("workspace");
    this.runApi(id, mode, abort).catch((e) => {
      if (abort.signal.aborted || this.api !== abort) return;
      a.result = { ...a.result, status: "error", message: e.message };
      this.api = null;
      this.update("apiStats");
    });
  }
  async runApi(id, mode, abort) {
    const a = this.store.workspace.apiStats;
    const signal = abort.signal;
    if (mode === "finished") {
      const match = await loadFinishedMatch(
        id,
        AbortSignal.any([signal, AbortSignal.timeout(45000)]),
      );
      if (signal.aborted) return;
      a.result = {
        match,
        status: "finished",
        message: "Finished match · recorded statistics",
        updated: Date.now(),
      };
      this.api = null;
      this.update("apiStats");
      return;
    }
    let rows = new Map(),
      pending = null,
      ended = false,
      heroInfo = {};
    loadStatHeroes(signal)
      .then((v) => {
        heroInfo = v;
      })
      .catch(() => {});
    const publish = () => {
      pending = null;
      if (signal.aborted) return;
      a.result = {
        match: {
          id,
          mode: "live",
          players: livePlayers(rows),
          duration: 0,
          heroInfo,
        },
        status: "live",
        message: "Receiving Deadlock API live events",
        updated: Date.now(),
      };
      const durable = Date.now() - this.apiSavedAt > 2000;
      if (durable) this.apiSavedAt = Date.now();
      this.update("apiStats", durable);
    };
    try {
      await streamLiveMatch(id, {
        signal,
        onEvent: ({ event, data }) => {
          if (event === "error") throw Error(liveFeedMessage(data));
          if (event === "end") {
            ended = true;
            return;
          }
          if (event === "status") {
            a.result.message = liveFeedMessage(data, "status");
            this.update("apiStats", false);
            return;
          }
          if (event !== "message") return;
          let row;
          try {
            row = JSON.parse(data);
          } catch {
            return;
          }
          rows = reduceLiveRow(rows, row);
          if (!pending) pending = setTimeout(publish, 250);
        },
      });
      if (signal.aborted) return;
      if (pending) {
        clearTimeout(pending);
        publish();
      }
      a.result.status = ended ? "ended" : "error";
      a.result.message = ended
        ? "Feed ended · load finished metadata to verify final totals."
        : "Connection closed · last received values retained.";
      this.api = null;
      this.update("apiStats");
    } finally {
      if (pending) clearTimeout(pending);
    }
  }
  stopApi() {
    this.api?.abort();
    this.api = null;
    const a = this.store.workspace.apiStats;
    a.result.status = a.result.match ? "disconnected" : "idle";
    a.result.message = "API feed stopped · last values retained.";
    a.source = null;
    this.update("apiStats");
  }
  stop() {
    this.draft?.();
    this.draft = null;
    this.stopApi();
  }
}

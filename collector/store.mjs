import { mkdir, readdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { matchId } from "./model.mjs";

export class SessionStore {
  constructor(directory) {
    this.directory = directory;
    this.sessions = new Map();
    this.pending = Promise.resolve();
  }
  async load() {
    await mkdir(this.directory, { recursive: true });
    for (const name of await readdir(this.directory)) {
      if (!/^\d+\.json$/.test(name)) continue;
      try {
        const state = JSON.parse(
          await readFile(path.join(this.directory, name), "utf8"),
        );
        if (state.version !== 1 || matchId(state.id) !== name.slice(0, -5))
          continue;
        state.effects = [];
        state.recentHits = [];
        if (!state.result) {
          state.status = "interrupted";
          state.message = "Collector restarted · reconnect this game to resume";
        }
        this.sessions.set(state.id, state);
      } catch {
        /* Keep an unreadable archive for recovery; do not treat it as a result. */
      }
    }
  }
  save(state) {
    const data = JSON.stringify(state);
    const target = path.join(this.directory, `${matchId(state.id)}.json`);
    this.pending = this.pending
      .catch(() => {})
      .then(async () => {
        await writeFile(`${target}.tmp`, data);
        await rename(`${target}.tmp`, target);
      });
    return this.pending;
  }
}

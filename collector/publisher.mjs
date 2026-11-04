import { randomBytes, randomUUID, createHash } from "node:crypto";
import { applySeriesWin } from "./enrichment.mjs";
import {
  emptySession,
  applyFrame,
  applyInterruption,
  sessionId,
} from "./model.mjs";

const hash = (value) =>
  createHash("sha256").update(String(value)).digest("hex");
const fail = (message, status = 400) => {
  throw Object.assign(Error(message), { status });
};
const label = (value) => String(value || "").slice(0, 100);
const finite = (value) => (Number.isFinite(value) ? value : null);
export class Publisher {
  constructor(store, changed, collector) {
    Object.assign(this, { store, changed, collector, failures: new Map() });
    store.db
      .exec(`CREATE TABLE IF NOT EXISTS publishers (hash TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS pairing (hash TEXT PRIMARY KEY, expires INTEGER NOT NULL, label TEXT NOT NULL);`);
    this.timer = setInterval(() => this.checkStale(), 3000);
    this.timer.unref();
  }
  list() {
    return this.store.db
      .prepare("SELECT value FROM publishers")
      .all()
      .map((r) => {
        const p = JSON.parse(r.value);
        return {
          id: p.id,
          label: p.label,
          createdAt: p.createdAt,
          revoked: p.revoked,
          lastSeen: p.lastSeen,
          activeGame: p.activeGame,
        };
      });
  }
  issue(value = {}) {
    const code = randomBytes(10).toString("hex").toUpperCase();
    const expires = Date.now() + 300000;
    this.store.db
      .prepare("DELETE FROM pairing WHERE expires<?")
      .run(Date.now());
    this.store.db
      .prepare("INSERT INTO pairing VALUES (?,?,?)")
      .run(hash(code), expires, label(value.label) || "Observer PC");
    return { code, expires };
  }
  pair(value, ip) {
    const failure = this.failures.get(ip) || {
      count: 0,
      until: Date.now() + 600000,
    };
    if (failure.until < Date.now()) {
      failure.count = 0;
      failure.until = Date.now() + 600000;
    }
    if (failure.count >= 10) fail("Too many attempts. Wait ten minutes.", 429);
    const key = hash(
      String(value.code || "")
        .trim()
        .toUpperCase(),
    );
    const row = this.store.db
      .prepare("SELECT * FROM pairing WHERE hash=?")
      .get(key);
    if (!row || row.expires < Date.now()) {
      failure.count++;
      this.failures.set(ip, failure);
      fail("Pairing code expired or incorrect.", 401);
    }
    const token = randomBytes(32).toString("base64url");
    const p = {
      id: randomUUID(),
      label: row.label,
      createdAt: Date.now(),
      revoked: false,
      lastSeen: null,
      activeGame: null,
    };
    this.store.db.exec("BEGIN IMMEDIATE");
    try {
      this.store.db.prepare("DELETE FROM pairing WHERE hash=?").run(key);
      this.store.db
        .prepare("INSERT INTO publishers VALUES (?,?)")
        .run(hash(token), JSON.stringify(p));
      this.store.db.exec("COMMIT");
    } catch (e) {
      this.store.db.exec("ROLLBACK");
      throw e;
    }
    return { token, publisherId: p.id, label: p.label };
  }
  authenticate(req) {
    const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(
      req.headers.authorization || "",
    )?.[1];
    const key = hash(token || "");
    const row = this.store.db
      .prepare("SELECT value FROM publishers WHERE hash=?")
      .get(key);
    if (!token || !row) fail("Pair this companion with the studio.", 401);
    const p = JSON.parse(row.value);
    if (p.revoked)
      fail("This companion was disconnected by an admin. Pair again.", 401);
    return { ...p, key };
  }
  save(p) {
    const { key, ...value } = p;
    this.store.db
      .prepare("UPDATE publishers SET value=? WHERE hash=?")
      .run(JSON.stringify(value), key);
  }
  revoke(id) {
    const row = this.store.db
      .prepare("SELECT hash,value FROM publishers")
      .all()
      .find((r) => JSON.parse(r.value).id === id);
    if (!row) fail("Companion not found.");
    const p = JSON.parse(row.value);
    p.revoked = true;
    this.save({ ...p, key: row.hash });
    const s = this.store.sessions.get(p.activeGame);
    if (s?.publisher?.id === id) {
      applyInterruption(s, "Observer companion disconnected by admin.");
      s.publisher.lease = null;
      this.store.save(s);
      this.changed("collector");
    }
  }
  begin(p, value) {
    if (this.collector.worker)
      fail(
        "Stop the relay/replay collector before connecting the observer.",
        409,
      );
    const id = sessionId(value.id);
    if (this.store.tournaments?.isDeleted(id))
      fail(
        "This recording was deleted. Restore it from Trash or prepare a new recording.",
        409,
      );
    if (!id.startsWith("local-"))
      fail("The companion must create a local game identifier.");
    for (const s of this.store.sessions.values())
      if (
        !s.result &&
        s.publisher?.lease &&
        s.publisher.id !== p.id &&
        Date.now() - s.publisher.lastSeen < 15000
      )
        fail(
          "Another observer is publishing. Disconnect it in the studio first.",
          409,
        );
    const old = this.store.sessions.get(id);
    if (
      old?.tournamentId &&
      old.tournamentId !== this.store.workspace.activeTournamentId
    )
      fail(
        "Select this recording's tournament in the studio before resuming it.",
        409,
      );
    if (old?.publisher?.id && old.publisher.id !== p.id)
      fail("This recording belongs to a different companion.", 409);
    for (const other of this.store.sessions.values())
      if (other.id !== id && other.publisher?.lease) {
        other.publisher.lease = null;
        applyInterruption(other, "Observer switched to another recording.");
        this.store.save(other);
      }
    const s = old || emptySession(id, value.rehearsal ? "rehearsal" : "local");
    // Reconnect always fences the previous process, including an older process on the same PC.
    const lease = randomBytes(24).toString("hex");
    s.publisher = {
      id: p.id,
      label: p.label,
      lease,
      lastSeen: Date.now(),
      sequence: 0,
    };
    s.label = label(value.label) || `Game ${this.store.workspace.config.game}`;
    s.tournament ||= this.store.workspace.config.event;
    s.tournamentId ||= this.store.workspace.activeTournamentId;
    s.recording = {
      clientVersion: label(value.clientVersion) || "0.1",
      name: label(value.recording),
      fromStart: value.fromStart === true,
      source: "local-client-demo",
    };
    this.store.sessions.set(id, s);
    p.activeGame = id;
    p.lastSeen = Date.now();
    this.save(p);
    this.store.workspace.deadem.id = id;
    this.store.workspace.revision++;
    this.store.saveWorkspace();
    this.store.save(s);
    this.changed();
    return { id, lease, sequence: 0 };
  }
  ingest(p, value) {
    const s = this.store.sessions.get(sessionId(value.id));
    if (
      s?.tournamentId &&
      s.tournamentId !== this.store.workspace.activeTournamentId
    )
      fail(
        "This recording belongs to another tournament. Select it in the studio before resuming.",
        409,
      );
    if (!s || s.publisher?.id !== p.id || value.lease !== s.publisher.lease)
      fail(
        "This recording connection was replaced. Reconnect the companion.",
        409,
      );
    if (!Number.isSafeInteger(value.sequence) || value.sequence < 1)
      fail("Invalid sequence.");
    if (value.sequence <= s.publisher.sequence)
      return { ack: s.publisher.sequence };
    const now = Date.now();
    if (
      value.frame &&
      Number.isFinite(s.match?.tick) &&
      value.frame.tick < s.match.tick
    ) {
      s.publisher.sequence = value.sequence;
      s.publisher.lastSeen = now;
      this.store.save(s);
      return { ack: value.sequence, catchingUp: true };
    }
    if (value.frame) {
      const wasEnded = Boolean(s.result);
      const raw = value.frame;
      if (!Array.isArray(raw.players) || raw.players.length > 12)
        fail("Invalid roster.");
      const players = raw.players.map((p) => {
        if (
          !/^\d{1,10}$/.test(p.id) ||
          ![0, 1].includes(p.team) ||
          !Number.isInteger(p.heroId)
        )
          fail("Invalid player identity.");
        const out = {
          id: p.id,
          name: label(p.name),
          heroId: p.heroId,
          team: p.team,
          slot: finite(p.slot),
        };
        for (const k of [
          "damage",
          "objectiveDamage",
          "healing",
          "souls",
          "kills",
          "deaths",
          "assists",
          "buffs",
          "lifeState",
        ])
          out[k] = finite(p[k]);
        out.buffTypes = Object.fromEntries(
          Object.entries(p.buffTypes || {}).filter(
            ([k, v]) =>
              /^[a-z0-9_]{1,50}$/.test(k) &&
              Number.isInteger(v) &&
              v >= 0 &&
              v < 1000,
          ),
        );
        out.items = Array.isArray(p.items)
          ? p.items.filter(Number.isSafeInteger).slice(0, 24)
          : null;
        out.abilities = Array.isArray(p.abilities)
          ? p.abilities.slice(0, 4).map((a) => ({
              slot: a.slot,
              id: a.id,
              level: [0, 1, 2, 3].includes(a.level) ? a.level : null,
              unlocked: typeof a.unlocked === "boolean" ? a.unlocked : null,
            }))
          : null;
        out.bridgeBuffs = (p.bridgeBuffs || []).slice(0, 4).map((b) => ({
          id: b.id,
          label: label(b.label),
          remaining: finite(b.remaining),
        }));
        return out;
      });
      applyFrame(
        s,
        {
          players,
          tick: finite(raw.tick),
          serverTick: finite(raw.serverTick),
          duration: finite(raw.duration),
          matchId: /^\d{1,15}$/.test(raw.matchId || "") ? raw.matchId : null,
          paused: raw.paused === true,
          winner: [0, 1].includes(raw.winner) ? raw.winner : null,
          endObserved: raw.endObserved === true,
        },
        now,
      );
      s.match.provider = "local-client-demo";
      if (s.result) s.result.match.provider = "local-client-demo";
      if (!wasEnded && applySeriesWin(this.store, s)) this.changed("workspace");
      if (!wasEnded && s.result) this.changed("reports");
      s.sourceTiming = {
        decodedAt: finite(value.decodedAt),
        receivedAt: now,
        sourceSeconds: finite(raw.duration),
        sourceTick: finite(raw.serverTick),
        fileLagMs: finite(value.fileLagMs),
      };
      if (!s.result) {
        s.message =
          s.mode === "rehearsal"
            ? "Local recording rehearsal"
            : "Receiving observer recording";
        s.effects = (value.effects || []).slice(0, 100);
        s.recentHits = (value.hits || []).slice(-40).map((h) => ({
          ...h,
          at: now - Math.max(0, Math.min(10000, value.decodedAt - h.at)),
        }));
      }
    }
    if (value.items) {
      if (
        !Array.isArray(value.items.purchases) ||
        value.items.purchases.length > 10000
      )
        fail("Invalid purchase history.");
      s.items = {
        ...value.items,
        purchases: value.items.purchases.map((row) => {
          if (
            !["pending", "confirmed", "refunded", "review"].includes(
              row.status,
            ) ||
            typeof row.id !== "string" ||
            !Number.isSafeInteger(row.itemId)
          )
            fail("Invalid purchase.");
          return {
            ...row,
            id: row.id.slice(0, 120),
            playerId: label(row.playerId),
            evidence: label(row.evidence),
          };
        }),
      };
      // Keep explicit operator corrections across collector retries/reparses.
      for (const row of s.items.purchases)
        if (s.itemReviews?.[row.id]) Object.assign(row, s.itemReviews[row.id]);
    }
    if (value.audit)
      s.audit = { complete: false, entries: value.audit.slice(-500) };
    if (value.stopped && !s.result)
      applyInterruption(
        s,
        "Recording stopped before a game-over signal. Last data saved.",
      );
    s.publisher.sequence = value.sequence;
    s.publisher.lastSeen = now;
    p.lastSeen = now;
    if (
      value.items ||
      value.stopped ||
      s.result ||
      now - (s.savedAt || 0) > 2000
    ) {
      s.savedAt = now;
      this.save(p);
      this.store.save(s);
    }
    this.changed("collector");
    return { ack: value.sequence, receivedAt: now, ended: Boolean(s.result) };
  }
  checkStale() {
    for (const s of this.store.sessions.values())
      if (
        !s.result &&
        s.mode !== "replay" &&
        s.publisher &&
        s.status === "live" &&
        Date.now() - s.updatedAt > 10000
      ) {
        applyInterruption(
          s,
          "Observer data is stale. Check the companion and recording.",
        );
        this.store.save(s);
        this.changed("collector");
      }
  }
  close() {
    clearInterval(this.timer);
  }
}

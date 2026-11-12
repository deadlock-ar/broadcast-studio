import {
  randomBytes,
  createHash,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
export class AdminAuth {
  constructor(db, password, secure = true, trusted = false) {
    if (
      !trusted &&
      (!password || password.length < 16 || password.length > 512)
    )
      throw Error(
        "Set ADMIN_PASSWORD to 16–512 characters before exposing the studio.",
      );
    this.db = db;
    this.trusted = trusted;
    this.secure = secure;
    const stored = db
      .prepare("SELECT value FROM settings WHERE key='admin-auth'")
      .get();
    const previous = stored ? JSON.parse(stored.value) : null;
    this.salt = previous ? Buffer.from(previous.salt, "hex") : randomBytes(16);
    this.password = scryptSync(
      password || randomBytes(32).toString("hex"),
      this.salt,
      32,
    );
    if (!trusted && previous?.hash !== this.password.toString("hex")) {
      // A changed Railway secret revokes sessions issued with the old password.
      db.exec("DELETE FROM logins");
      db.prepare(
        "INSERT OR REPLACE INTO settings VALUES ('admin-auth', ?)",
      ).run(
        JSON.stringify({
          salt: this.salt.toString("hex"),
          hash: this.password.toString("hex"),
        }),
      );
    }
    this.limits = new Map();
  }
  hash(v) {
    return createHash("sha256").update(v).digest("hex");
  }
  authenticated(request) {
    if (this.trusted) return true;
    const cookie = request.headers.cookie?.match(
      /(?:^|; )dlar_admin=([A-Za-z0-9_-]{43})(?:;|$)/,
    )?.[1];
    return Boolean(
      cookie &&
      this.db
        .prepare("SELECT hash FROM logins WHERE hash=? AND expires>?")
        .get(this.hash(cookie), Date.now()),
    );
  }
  cookie(value, age) {
    return `dlar_admin=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${this.secure ? "; Secure" : ""}`;
  }
  login(request, response, password) {
    // Do not trust a user-supplied forwarding header as a rate-limit identity.
    const key = request.socket.remoteAddress || "unknown";
    const now = Date.now();
    let limit = this.limits.get(key);
    if (!limit || limit.until < now) {
      limit = { attempts: 0, until: now + 60000 };
      this.limits.set(key, limit);
    }
    if (++limit.attempts > 8) {
      const e = Error("Too many attempts. Try again in a minute.");
      e.status = 429;
      throw e;
    }
    const candidate = scryptSync(
      String(password || "").slice(0, 512),
      this.salt,
      32,
    );
    if (!timingSafeEqual(candidate, this.password)) {
      const e = Error("Incorrect admin password.");
      e.status = 401;
      throw e;
    }
    const token = randomBytes(32).toString("base64url");
    this.db.prepare("DELETE FROM logins WHERE expires < ?").run(now);
    this.db
      .prepare("INSERT INTO logins VALUES (?,?)")
      .run(this.hash(token), now + 7 * 86400000);
    response.setHeader("Set-Cookie", this.cookie(token, 7 * 86400));
  }
  logout(request, response) {
    const token = request.headers.cookie?.match(
      /(?:^|; )dlar_admin=([^;]+)/,
    )?.[1];
    if (token)
      this.db.prepare("DELETE FROM logins WHERE hash=?").run(this.hash(token));
    response.setHeader("Set-Cookie", this.cookie("", 0));
  }
}

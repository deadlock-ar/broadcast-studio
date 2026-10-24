import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createBroadcastServer } from "./cloud-server.mjs";
import { exportBackup, prepareRestore } from "./backups.mjs";

test("native publisher authenticates separately, cannot edit controls, and feeds permanent OBS URLs", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "dlar-http-publisher-"));
  const app = await createBroadcastServer({
    directory: dir,
    port: 0,
    origin: "http://studio.test",
    hosted: true,
    password: "test-password-at-least-sixteen",
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await app.shutdown();
    await rm(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  async function post(route, value, headers = {}) {
    const r = await fetch(base + route, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(value),
    });
    return { status: r.status, data: await r.json(), headers: r.headers };
  }
  const login = await post(
    "/api/login",
    { password: "test-password-at-least-sixteen" },
    { Origin: app.origin },
  );
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const code = await post(
    "/api/publisher/code",
    { label: "Observer test" },
    { Origin: app.origin, Cookie: cookie },
  );
  assert.equal(code.status, 200);
  const paired = await post("/api/publisher/pair", { code: code.data.code });
  assert.equal(paired.status, 200);
  const token = { Authorization: `Bearer ${paired.data.token}` };
  const denied = await fetch(base + "/api/workspace", { headers: token });
  assert.equal(denied.status, 401);
  assert.equal(
    (
      await post(
        "/api/publisher/begin",
        { id: `local-${randomUUID()}` },
        { ...token, Origin: "https://other-site.test" },
      )
    ).status,
    403,
  );
  const begun = await post(
    "/api/publisher/begin",
    { id: `local-${randomUUID()}`, fromStart: true },
    token,
  );
  assert.equal(begun.status, 200);
  const players = Array.from({ length: 12 }, (_, i) => ({
    id: String(i + 1),
    heroId: i + 1,
    team: i < 6 ? 0 : 1,
    slot: i,
    damage: i * 100,
    buffs: i,
  }));
  const ingested = await post(
    "/api/publisher/ingest",
    { ...begun.data, sequence: 1, frame: { tick: 10, duration: 50, players } },
    token,
  );
  assert.equal(ingested.status, 200);
  const output = await fetch(base + "/api/broadcast?channel=deadem").then((r) =>
    r.json(),
  );
  assert.equal(output.session.match.players.length, 12);
  assert.ok(!JSON.stringify(output).includes(begun.data.lease));
  assert.equal(output.session.match.provider, "local-client-demo");
  const finished = await post(
    "/api/publisher/ingest",
    {
      ...begun.data,
      sequence: 2,
      frame: { tick: 11, duration: 51, players, endObserved: true, winner: 0 },
    },
    token,
  );
  assert.equal(finished.status, 200);
  const backup = exportBackup(app.store);
  assert.ok(!JSON.stringify(backup).includes(begun.data.lease));
  const restored = prepareRestore(backup, app.store);
  assert.equal(restored.sessions[0].result.match.players.length, 12);
  assert.equal(restored.sessions[0].publisher, undefined);
  assert.throws(() =>
    prepareRestore(
      {
        version: 2,
        workspace: {},
        matches: [{ version: 1, id: "../../../data" }],
      },
      app.store,
    ),
  );
});

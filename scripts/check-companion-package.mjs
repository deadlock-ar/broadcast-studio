// Full loopback rehearsal of the shipped package. Never targets a hosted studio.
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import assert from "node:assert/strict";
const root = path.resolve(process.argv[2]),
  fixture = path.resolve(process.argv[3]);
const studio = "http://127.0.0.1:49338",
  helper = "http://127.0.0.1:49337",
  data = path.join(root, ".dlar-observer"),
  folder = path.join(root, "fixture-game");
await fs.mkdir(data, { recursive: true });
await fs.mkdir(folder, { recursive: true });
async function api(base, route, value, token) {
  const response = await fetch(base + route, {
    ...(value
      ? {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: base,
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(value),
        }
      : {}),
  });
  const result = await response.json();
  if (!response.ok) throw Error(result.error);
  return result;
}
const code = await api(studio, "/api/publisher/code", {
    label: "LOCAL PACKAGE TEST",
  }),
  paired = await api(studio, "/api/publisher/pair", { code: code.code });
await fs.writeFile(
  path.join(data, "connection.json"),
  JSON.stringify({
    studio,
    token: paired.token,
    publisherId: paired.publisherId,
    gameFolder: folder,
  }),
  { mode: 0o600 },
);
const child = spawn(
  path.join(root, "runtime", "node.exe"),
  [path.join(root, "companion", "observer.mjs")],
  {
    cwd: root,
    env: { ...process.env, DLAR_NO_BROWSER: "1", DLAR_OBSERVER_PORT: "49337" },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let output = "";
child.stdout.on("data", (b) => (output += b));
child.stderr.on("data", (b) => (output += b));
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      await api(helper, "/state");
      ready = true;
      break;
    } catch {
      await wait(100);
    }
  }
  assert.ok(ready, "Package did not start: " + output);
  const run = await api(helper, "/start", {
    gameFolder: folder,
    fromStart: false,
    label: "LOCAL PACKAGE TEST · incomplete fixture",
  });
  assert.ok(path.resolve(run.run.file).startsWith(folder + path.sep));
  const bytes = await fs.readFile(fixture),
    handle = await fs.open(run.run.file, "wx");
  try {
    for (let offset = 0; offset < bytes.length; offset += 524288) {
      await handle.write(bytes.subarray(offset, offset + 524288));
      await wait(30);
    }
  } finally {
    await handle.close();
  }
  let state, session;
  for (let i = 0; i < 120; i++) {
    state = await api(helper, "/state");
    session = await api(studio, `/api/collector/state?match=${run.run.id}`);
    if (
      session.status === "interrupted" &&
      session.items?.purchases?.length > 20
    )
      break;
    await wait(250);
  }
  assert.equal(state.data.players, 12);
  assert.equal(session.match.players.length, 12);
  assert.equal(session.result, null);
  assert.equal(
    session.items.purchases.filter((p) => p.status === "refunded").length,
    2,
  );
  const publicView = await api(studio, "/api/broadcast?channel=deadem");
  assert.equal(publicView.session.id, run.run.id);
  console.log(
    JSON.stringify({
      bundledRuntimeWorks: true,
      pairedOutboundPublishing: true,
      players: session.match.players.length,
      refundedPurchases: 2,
      finalResultInvented: false,
      gameId: run.run.id,
    }),
  );
} finally {
  child.kill();
  await api(studio, "/api/publisher/revoke", { id: paired.publisherId });
}

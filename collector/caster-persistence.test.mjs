import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createBroadcastServer } from "./cloud-server.mjs";
import { exportBackup, prepareRestore } from "./backups.mjs";
import { patchWorkspace, diffFields } from "../src/workspace-model.js";

test("fixed caster IDs persist through patches, tournament switches, backup and restart but not public broadcasts", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "dlar-caster-ids-"));
  const opened = new Set();
  const start = async () => {
    const app = await createBroadcastServer({
      directory,
      port: 0,
      origin: "http://caster-test.local",
      password: "",
      hosted: false,
    });
    opened.add(app);
    return app;
  };
  const close = async (app) => {
    await app.shutdown();
    opened.delete(app);
  };
  t.after(async () => {
    for (const app of opened) await app.shutdown();
    assert.ok(directory.startsWith(path.join(tmpdir(), "dlar-caster-ids-")));
    await rm(directory, { recursive: true, force: true });
  });
  let app = await start();
  const ids = [
    "100000000000000001",
    "100000000000000002",
    "100000000000000003",
  ];
  const first = app.store.workspace.activeTournamentId;
  const next = patchWorkspace(
    app.store.workspace,
    diffFields(
      app.store.workspace.casterStage,
      {
        ...app.store.workspace.casterStage,
        layout: "discord",
        casterCount: 3,
        casters: ids.map((discordUserId, i) => ({
          name: `Caster ${i + 1}`,
          discordUserId,
        })),
      },
      ["casterStage"],
    ),
  );
  app.store.applyPatch(randomUUID(), next);
  const expected = structuredClone(app.store.workspace.casterStage);
  const second = app.store.tournaments.create({
    name: "Another caster tournament",
  });
  assert.ok(
    app.store.workspace.casterStage.casters.every(
      (person) => !person.discordUserId,
    ),
  );
  app.store.tournaments.select(first);
  assert.deepEqual(app.store.workspace.casterStage, expected);
  const restored = prepareRestore(exportBackup(app.store), app.store);
  assert.deepEqual(restored.workspace.casterStage, expected);
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const response = await fetch(
    `http://127.0.0.1:${app.server.address().port}/api/broadcast?channel=casters`,
  );
  assert.equal(response.status, 200);
  const body = await response.text();
  for (const id of ids) assert.ok(!body.includes(id));
  assert.ok(body.includes("Caster 1"));
  await close(app);
  app = await start();
  assert.deepEqual(app.store.workspace.casterStage, expected);
  app.store.tournaments.select(second.id);
  assert.ok(
    app.store.workspace.casterStage.casters.every(
      (person) => !person.discordUserId,
    ),
  );
  app.store.tournaments.select(first);
  assert.deepEqual(app.store.workspace.casterStage, expected);
});

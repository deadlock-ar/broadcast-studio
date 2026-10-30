import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { createBroadcastServer } from "./cloud-server.mjs";
import { emptySession, applyFrame } from "./model.mjs";
import { prepareTournamentBracket } from "./bracket-service.mjs";
import { blankDraft } from "../src/workspace-model.js";

const entrants = () =>
  ["Alpha", "Beta", "Gamma", "Delta"].map((name, index) => ({
    id: randomUUID(),
    name,
    tag: name.slice(0, 1),
    players: [
      {
        id: randomUUID(),
        name: `${name} player`,
        steamId: String(index + 1000),
      },
    ],
  }));

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "dlar-bracket-http-"));
  const web = path.join(directory, "web");
  await mkdir(web);
  await writeFile(path.join(web, "index.html"), "<main>Bracket</main>");
  const app = await createBroadcastServer({
    directory,
    staticDirectory: web,
    port: 0,
    origin: "http://bracket.test",
    password: "bracket-testing-password",
    hosted: true,
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const abort = new AbortController();
  t.after(async () => {
    abort.abort();
    await app.shutdown();
    await rm(directory, { recursive: true, force: true });
  });
  const post = (route, value, cookie = "", header = true) =>
    fetch(base + route, {
      method: "POST",
      headers: {
        Origin: app.origin,
        "Content-Type": "application/json",
        Cookie: cookie,
        ...(header
          ? { "X-DLAR-Tournament": app.store.workspace.activeTournamentId }
          : {}),
      },
      body: JSON.stringify(value),
    });
  const login = await post("/api/login", {
    password: "bracket-testing-password",
  });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const command = (
    action,
    value = {},
    expectedRevision = app.store.workspace.bracket.revision,
  ) => post(`/api/bracket/${action}`, { ...value, expectedRevision }, cookie);
  const setup = async (format = "BO3", options = {}) => {
    const response = await post(
      "/api/tournaments/create",
      {
        name: "Bracket Cup",
        entrants: entrants(),
        generate: true,
        seeding: "manual",
        seriesFormat: format,
        saveToLibrary: true,
        ...options,
      },
      cookie,
    );
    assert.equal(
      response.status,
      200,
      JSON.stringify(await response.clone().json()),
    );
    return response.json();
  };
  const addGame = async (id, winner = 0, numericId = id, mode = "live") => {
    const session = emptySession(id, mode);
    session.tournamentId = app.store.workspace.activeTournamentId;
    applyFrame(session, {
      matchId: numericId,
      duration: 120,
      endObserved: true,
      winner,
      players: Array.from({ length: 12 }, (_, index) => ({
        id: String(index + 1),
        team: index < 6 ? 0 : 1,
        slot: index,
        heroId: 1,
        name: `Player ${index}`,
      })),
    });
    app.store.sessions.set(id, session);
    await app.store.save(session);
    return session;
  };
  return { app, base, abort, post, cookie, command, setup, addGame };
}

test("tournament entrant preparation validates player identity and canonical Steam accounts", () => {
  const teams = entrants();
  const bracket = prepareTournamentBracket({
    entrants: teams,
    generate: true,
    seeding: "manual",
    seriesFormat: "BO1",
  });
  assert.equal(bracket.entrants[0].players[0].steamId, "76561197960266728");
  assert.equal(bracket.matches.length, 3);
  const repeated = entrants();
  repeated[1].players[0].id = repeated[0].players[0].id;
  repeated[0].players[0].steamId = "";
  repeated[1].players[0].steamId = "";
  assert.throws(() => prepareTournamentBracket({ entrants: repeated }));
  assert.throws(() =>
    prepareTournamentBracket({
      entrants: [{ name: "Team", players: [{ name: "", steamId: "1000" }] }],
    }),
  );
  assert.throws(() =>
    prepareTournamentBracket({ entrants: [{ name: "Team", id: "invalid" }] }),
  );
});

test("roster and bracket routes protect writes and use the independent bracket revision", async (t) => {
  const { app, base, post, cookie, command, setup } = await fixture(t);
  assert.equal((await fetch(base + "/api/roster-library")).status, 401);
  assert.equal(
    (await post("/api/roster-library/player", { name: "No access" })).status,
    401,
  );
  assert.equal(
    (
      await post("/api/bracket/settings", {
        visible: false,
        expectedRevision: 0,
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await post(
        "/api/bracket/settings",
        { visible: false, expectedRevision: 0 },
        cookie,
        false,
      )
    ).status,
    409,
  );
  await setup();
  assert.equal(app.store.rosterLibrary.list().teams.length, 4);
  const revision = app.store.workspace.bracket.revision;
  app.store.workspace.revision += 10;
  assert.equal(
    (await command("settings", { transparent: true }, revision)).status,
    200,
  );
  assert.equal(
    (await command("settings", { visible: false }, revision)).status,
    409,
  );
  assert.equal(app.store.workspace.bracket.visible, true);
  assert.equal(app.store.workspace.bracket.transparent, true);
  const before = app.store.rosterLibrary.snapshot();
  const invalid = entrants();
  invalid[3].players[0].steamId = "bad";
  assert.equal(
    (await command("entrants", { entrants: invalid, saveToLibrary: true }))
      .status,
    400,
  );
  assert.deepEqual(app.store.rosterLibrary.snapshot(), before);
  assert.equal((await fetch(base + "/obs/bracket")).status, 200);
  const publicData = await (
    await fetch(base + "/api/broadcast?channel=bracket")
  ).json();
  assert.deepEqual(Object.keys(publicData), ["bracket"]);
  assert.equal(JSON.stringify(publicData).includes("steamId"), false);
  assert.equal(JSON.stringify(publicData).includes("playerIds"), false);
});

test("confirmed published game advances the prepared bracket and live OBS stream exactly once", async (t) => {
  const { app, base, abort, post, cookie, command, setup, addGame } =
    await fixture(t);
  await setup("BO1");
  assert.equal((await command("prepare", { matchId: "r1-m1" })).status, 200);
  assert.deepEqual(
    app.store.workspace.config.teams.map((team) => team.name),
    ["Alpha", "Beta"],
  );
  assert.equal(app.store.workspace.config.format, "BO1");
  // Cosmetic score edits are not results and cannot advance a bracket.
  app.store.workspace.config.teams[0].score = 20;
  assert.equal(app.store.workspace.bracket.matches[0].winnerId, null);
  const stream = await fetch(base + "/api/broadcast/events?channel=bracket", {
    signal: abort.signal,
  });
  const reader = stream.body.getReader();
  let pending = "";
  const decoder = new TextDecoder();
  const event = async () => {
    while (!pending.includes("\n\n")) {
      const part = await reader.read();
      pending += decoder.decode(part.value, { stream: true });
    }
    const end = pending.indexOf("\n\n");
    const frame = pending.slice(0, end);
    pending = pending.slice(end + 2);
    return JSON.parse(frame.slice(6));
  };
  await event();
  const session = await addGame("100");
  const presentation = {
    ...structuredClone(app.store.workspace.config),
    winner: 0,
  };
  assert.equal(
    (await post("/api/collector/publish?match=100", presentation, cookie))
      .status,
    200,
  );
  const changed = await event();
  const winnerId = app.store.workspace.bracket.entrants[0].id;
  assert.equal(changed.bracket.rounds[0].matches[0].winnerId, winnerId);
  assert.deepEqual(
    app.store.workspace.config.teams.map((team) => team.score),
    [1, 0],
  );
  assert.equal(session.bracketAward.winnerId, winnerId);
  const revision = app.store.workspace.bracket.revision;
  assert.equal(
    (await post("/api/collector/publish?match=100", presentation, cookie))
      .status,
    200,
  );
  assert.equal(app.store.workspace.bracket.revision, revision);
  assert.equal((await command("generate", { seeding: "seeded" })).status, 409);
  assert.equal(
    (await command("result", { matchId: "r1-m1", scores: [0, 1] })).status,
    200,
  );
  assert.deepEqual(
    app.store.workspace.config.teams.map((team) => team.score),
    [0, 1],
  );
  assert.equal(
    (await command("clear-result", { matchId: "r1-m1" })).status,
    200,
  );
  assert.deepEqual(
    app.store.workspace.config.teams.map((team) => team.score),
    [0, 0],
  );
  assert.equal(app.store.workspace.bracket.matches[2].teamIds[0], null);
  await reader.cancel();
});

test("automatic results check the original published pair, reversed sides, rehearsals and duplicate recordings", async (t) => {
  const { app, post, cookie, command, setup, addGame } = await fixture(t);
  await setup("BO3");
  await command("prepare", { matchId: "r1-m1" });
  await addGame("200");
  const original = structuredClone(app.store.workspace.config);
  const wrong = {
    ...original,
    teams: [{ name: "Wrong one" }, { name: "Wrong two" }],
    winner: 0,
  };
  assert.equal(
    (await post("/api/collector/publish?match=200", wrong, cookie)).status,
    200,
  );
  assert.deepEqual(app.store.workspace.bracket.matches[0].scores, [0, 0]);
  assert.match(app.store.workspace.bracket.lastSync.message, /do not match/);
  const reversed = await addGame("201", 0);
  const flipped = {
    ...original,
    teams: [...original.teams].reverse(),
    winner: 0,
  };
  assert.equal(
    (await post("/api/collector/publish?match=201", flipped, cookie)).status,
    200,
  );
  assert.deepEqual(app.store.workspace.bracket.matches[0].scores, [0, 1]);
  assert.equal(
    reversed.bracketAward.winnerId,
    app.store.workspace.bracket.entrants[1].id,
  );
  assert.equal(
    reversed.published.teams[reversed.published.winner].name,
    original.teams[1].name,
  );
  assert.deepEqual(
    app.store.workspace.config.teams.map((team) => team.score),
    [0, 1],
  );
  assert.equal(reversed.published.teams[0].score, 1);
  assert.equal(
    (
      await post(
        "/api/collector/publish?match=201",
        { ...flipped, winner: 1 },
        cookie,
      )
    ).status,
    200,
  );
  assert.deepEqual(app.store.workspace.bracket.matches[0].scores, [0, 1]);
  assert.match(
    app.store.workspace.bracket.lastSync.message,
    /already applied to r1-m1.*manually/,
  );
  await addGame("202", 0, "201");
  assert.equal(
    (await post("/api/collector/publish?match=202", flipped, cookie)).status,
    200,
  );
  assert.deepEqual(app.store.workspace.bracket.matches[0].scores, [0, 1]);
  await addGame("203", 0, "203", "replay");
  assert.equal(
    (
      await post(
        "/api/collector/publish?match=203",
        { ...original, winner: 0 },
        cookie,
      )
    ).status,
    200,
  );
  assert.deepEqual(app.store.workspace.bracket.matches[0].scores, [0, 1]);
  assert.equal(
    (await command("generate", { resetConfirmed: true, seeding: "manual" }))
      .status,
    200,
  );
  await command("prepare", { matchId: "r1-m1" });
  assert.equal(
    (await post("/api/collector/publish?match=201", flipped, cookie)).status,
    200,
  );
  assert.deepEqual(app.store.workspace.bracket.matches[0].scores, [0, 0]);
});

test("a tournament switch during a partial bracket request cannot edit the newly selected tournament", async (t) => {
  const { app, base, cookie } = await fixture(t);
  const first = app.store.workspace.activeTournamentId;
  const second = app.store.tournaments.create("Other tournament").id;
  app.store.tournaments.select(first);
  let request;
  const arrived = new Promise((resolve) =>
    app.server.once("request", (incoming) => incoming.once("data", resolve)),
  );
  const response = new Promise((resolve, reject) => {
    request = http.request(
      base + "/api/bracket/settings",
      {
        method: "POST",
        headers: {
          Origin: app.origin,
          "Content-Type": "application/json",
          Cookie: cookie,
          "X-DLAR-Tournament": first,
        },
      },
      (incoming) => {
        let content = "";
        incoming.on("data", (chunk) => {
          content += chunk;
        });
        incoming.on("end", () =>
          resolve({ status: incoming.statusCode, body: JSON.parse(content) }),
        );
      },
    );
    request.on("error", reject);
    request.write('{"expectedRevision":0,');
  });
  await arrived;
  app.store.tournaments.select(second);
  request.end('"visible":false}');
  const result = await response;
  assert.equal(result.status, 409);
  assert.equal(app.store.workspace.activeTournamentId, second);
  assert.equal(app.store.workspace.bracket.visible, true);
});

test("round-format settings preserve the draw and completed earlier rounds while rejecting changes to played rounds", async (t) => {
  const { app, command, setup } = await fixture(t);
  const field = entrants();
  field.push({ id: randomUUID(), name: "Epsilon", players: [] });
  await setup("BO1", { entrants: field, seeding: "seeded" });
  const before = structuredClone(app.store.workspace.bracket);
  assert.equal(before.matches.filter((match) => match.required).length, 4);
  assert.equal(
    (
      await command("formats", {
        roundFormats: { r1: "BO1", r2: "BO1", r3: "BO3" },
      })
    ).status,
    200,
  );
  assert.deepEqual(app.store.workspace.bracket.slots, before.slots);
  assert.deepEqual(app.store.workspace.bracket.entrants, before.entrants);
  const opening = app.store.workspace.bracket.matches.find(
    (match) => match.required && match.round === 0,
  );
  assert.equal(
    (
      await command("result", {
        matchId: opening.id,
        winnerId: opening.teamIds[0],
      })
    ).status,
    200,
  );
  const completed = structuredClone(app.store.workspace.bracket);
  assert.equal(
    (
      await command("formats", {
        roundFormats: { r1: "BO1", r2: "BO1", r3: "BO5" },
      })
    ).status,
    200,
  );
  assert.deepEqual(app.store.workspace.bracket.slots, before.slots);
  assert.deepEqual(
    app.store.workspace.bracket.matches.filter((match) => match.round < 2),
    completed.matches.filter((match) => match.round < 2),
  );
  assert.equal(app.store.workspace.bracket.matches.at(-1).seriesFormat, "BO5");
  const protectedState = structuredClone(app.store.workspace);
  const rejected = await command("formats", {
    roundFormats: { r1: "BO3", r2: "BO1", r3: "BO5" },
  });
  assert.equal(rejected.status, 400);
  assert.match((await rejected.json()).error, /already has results/);
  assert.deepEqual(app.store.workspace, protectedState);
  assert.equal(
    (await command("formats", { roundFormats: { r3: "BO99" } })).status,
    400,
  );
  assert.deepEqual(app.store.workspace, protectedState);
});

test("BO1 early rounds and a BO3 final use the right prepared format and confirmed-game threshold", async (t) => {
  const { app, base, post, cookie, command, setup, addGame } = await fixture(t);
  await setup("BO1", { finalFormat: "BO3" });
  const state = app.store.workspace.bracket;
  assert.equal(state.matches[0].seriesFormat, "BO1");
  assert.equal(state.matches.at(-1).seriesFormat, "BO3");
  assert.equal((await command("prepare", { matchId: "r1-m1" })).status, 200);
  assert.equal(app.store.workspace.config.format, "BO1");
  assert.equal(app.store.workspace.config.round, "Semifinals");
  await addGame("310");
  assert.equal(
    (
      await post(
        "/api/collector/publish?match=310",
        {
          ...structuredClone(app.store.workspace.config),
          winner: 0,
        },
        cookie,
      )
    ).status,
    200,
  );
  assert.equal(app.store.workspace.bracket.matches[0].status, "complete");
  assert.deepEqual(app.store.workspace.bracket.matches[0].scores, [1, 0]);
  assert.equal(
    (
      await command("result", {
        matchId: "r1-m2",
        winnerId: state.entrants[2].id,
      })
    ).status,
    200,
  );
  assert.deepEqual(app.store.workspace.bracket.matches[1].scores, [1, 0]);
  assert.equal((await command("prepare", { matchId: "r2-m1" })).status, 200);
  assert.equal(app.store.workspace.config.format, "BO3");
  assert.equal(app.store.workspace.config.round, "Final");
  for (const id of ["311", "312"]) {
    await addGame(id);
    assert.equal(
      (
        await post(
          `/api/collector/publish?match=${id}`,
          {
            ...structuredClone(app.store.workspace.config),
            winner: 0,
          },
          cookie,
        )
      ).status,
      200,
    );
    const final = app.store.workspace.bracket.matches.at(-1);
    assert.equal(final.status, id === "311" ? "ready" : "complete");
    assert.equal(final.scores[0], id === "311" ? 1 : 2);
    assert.equal(app.store.workspace.config.format, "BO3");
  }
  const output = await (
    await fetch(base + "/api/broadcast?channel=bracket")
  ).json();
  assert.equal(output.bracket.champion.id, state.entrants[0].id);
  assert.deepEqual(
    output.bracket.rounds.map((round) => round.seriesFormat),
    ["BO1", "BO3"],
  );
});

test("starting a selected bracket draft archives the previous teams and selections and creates a clean board", async (t) => {
  const { app, command, setup } = await fixture(t);
  await setup("BO1", { finalFormat: "BO3" });
  const workspace = app.store.workspace;
  workspace.config.teams[0].name = "Previous left team";
  workspace.config.teams[1].name = "Previous right team";
  workspace.config.round = "Previous round";
  workspace.config.game = 3;
  Object.assign(workspace.draft, {
    mode: "manual",
    code: "PREVIOUS",
    archiveId: null,
    snapshot: blankDraft(2),
    bracketMatchId: "previous-match",
  });
  workspace.draft.snapshot.steps[0].heroId = 1;
  workspace.draft.snapshot.steps.find(
    (step) => step.selectionType === "pick",
  ).heroId = 6;
  const oldDraft = structuredClone(workspace.draft.snapshot);
  app.store.saveWorkspace();
  assert.equal(app.store.archive.list().length, 0);
  assert.equal(
    (await command("prepare", { matchId: "r1-m1", startDraft: true })).status,
    200,
  );
  const archived = app.store.archive.list();
  assert.equal(archived.length, 1);
  assert.deepEqual(archived[0].snapshot, oldDraft);
  assert.equal(archived[0].code, "PREVIOUS");
  assert.deepEqual(
    archived[0].config.teams.map((team) => team.name),
    ["Previous left team", "Previous right team"],
  );
  assert.equal(workspace.draft.mode, "manual");
  assert.equal(workspace.draft.code, "");
  assert.equal(workspace.draft.archiveId, null);
  assert.equal(workspace.draft.bracketMatchId, "r1-m1");
  assert.equal(workspace.bracket.activeMatchId, "r1-m1");
  assert.equal(workspace.draft.snapshot.status, "WAITING");
  assert.ok(
    workspace.draft.snapshot.steps.every((step) => step.heroId === null),
  );
  assert.equal(
    workspace.draft.snapshot.steps.filter(
      (step) => step.selectionType === "ban",
    ).length,
    4,
  );
  assert.deepEqual(
    workspace.config.teams.map((team) => team.name),
    ["Alpha", "Beta"],
  );
  assert.equal(workspace.config.format, "BO1");
});

test("starting a bracket draft rejects a live draft or active observer without replacing the board", async (t) => {
  const { app, command, setup } = await fixture(t);
  await setup("BO1");
  const draft = app.store.workspace.draft;
  draft.mode = "live";
  draft.code = "LIVE-ROOM";
  draft.snapshot.steps[0].heroId = 1;
  app.store.saveWorkspace();
  const before = structuredClone(app.store.workspace);
  const live = await command("prepare", { matchId: "r1-m1", startDraft: true });
  assert.equal(live.status, 400);
  assert.match((await live.json()).error, /Disconnect.*live draft/);
  assert.deepEqual(app.store.workspace, before);
  assert.deepEqual(app.store.archive.list(), []);
  draft.mode = "manual";
  const active = emptySession("399");
  active.tournamentId = app.store.workspace.activeTournamentId;
  active.publisher = { lease: "active-test-lease", lastSeen: Date.now() };
  app.store.sessions.set(active.id, active);
  const beforeCollection = structuredClone(app.store.workspace);
  const collecting = await command("prepare", {
    matchId: "r1-m1",
    startDraft: true,
  });
  assert.equal(collecting.status, 409);
  assert.match(
    (await collecting.json()).error,
    /Stop.*recording|Stop.*collection/,
  );
  assert.deepEqual(app.store.workspace, beforeCollection);
  assert.deepEqual(app.store.archive.list(), []);
});

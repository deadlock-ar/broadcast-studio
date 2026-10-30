import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  applyProfileNames,
  cleanPanel,
  createSseParser,
  liveFeedMessage,
  livePlayers,
  liveQueryUrl,
  loadFinishedMatch,
  loadStatHeroes,
  normalizeMetadata,
  panelUrl,
  parseMatchId,
  playersAt,
  readPanelUrl,
  reduceLiveRow,
  sortPlayers,
  streamLiveMatch,
} from "../src/stats.js";

// Real match stats, reduced to the fields we use. Account IDs are replaced with slots.
const fixture = JSON.parse(
  fs.readFileSync(new URL("./match-120513539.fixture.json", import.meta.url)),
);
const sample = () => normalizeMetadata(fixture, "120513539");
test("relay progress, relay failure and parser failures have distinct explanations", () => {
  const refusal = JSON.stringify({
    error:
      "Live broadcast error: live broadcast error: Valve's relay never started this match's broadcast (still \"Broadcast has not started yet\" after 60s).",
  });
  assert.match(
    liveFeedMessage(refusal, "status"),
    /retrying for up to a minute/,
  );
  assert.match(liveFeedMessage(refusal), /during the connection attempt/);
  assert.doesNotMatch(
    liveFeedMessage(refusal),
    /private|live broadcast error/i,
  );
  assert.match(
    liveFeedMessage('{"error":"schema discovery task failed"}'),
    /data provider could not decode/,
  );
  assert.match(
    liveFeedMessage('{"message":"Too many requests"}'),
    /rate limited/,
  );
  assert.equal(
    liveFeedMessage('{"message":"Receiving fragments"}', "status"),
    "Receiving fragments",
  );
  assert.equal(
    liveFeedMessage(
      "Live broadcast error: Live broadcast error: relay disconnected",
    ),
    "relay disconnected",
  );
  assert.match(liveFeedMessage(""), /live feed stopped/);
});
test("new hero artwork is refreshed only from the expected asset host", async () => {
  const result = await loadStatHeroes(
    new AbortController().signal,
    async () => ({
      ok: true,
      json: async () => [
        {
          id: 86,
          name: "Violet",
          images: {
            icon_hero_card_webp:
              "https://assets-bucket.deadlock-api.com/assets-api-res/images/heroes/artist_card.webp",
          },
        },
        {
          id: 99,
          name: "Bad",
          images: {
            icon_hero_card_webp: "https://untrusted.example/card.webp",
          },
        },
      ],
    }),
  );
  assert.equal(result[86].name, "Violet");
  assert.equal(result[99], undefined);
});
test("custom match 120513539 has twelve players, verified damage and permanent pickup totals", () => {
  const match = sample(),
    players = playersAt(match);
  assert.equal(match.duration, 2525);
  assert.equal(players.length, 12);
  assert.equal(players.filter((p) => p.team === 0).length, 6);
  assert.equal(
    players.reduce((sum, p) => sum + p.damage, 0),
    651398,
  );
  assert.equal(
    players.reduce((sum, p) => sum + p.buffs, 0),
    322,
  );
  assert.equal(players.find((p) => p.heroId === 19).buffs, 36);
  assert.equal(players.find((p) => p.heroId === 31).kills, 8); // final top-level K/D/A takes precedence
});
test("recorded frames never borrow future damage or pickups", () => {
  const match = sample();
  const start = playersAt(match, 0);
  assert.ok(start.every((p) => p.damage === null && p.buffs === 0));
  const middle = playersAt(match, 180);
  assert.equal(middle.find((p) => p.heroId === 31).damage, 624);
  assert.ok(middle.reduce((sum, p) => sum + p.buffs, 0) < 322);
});
test("missing stats stay unknown while genuine zero stats remain zero", () => {
  const input = structuredClone(fixture);
  input.match_info.players[0].stats = [
    { time_stamp_s: 3, player_damage: 0, player_healing: null },
  ];
  delete input.match_info.players[0].power_up_buffs;
  const p = playersAt(normalizeMetadata(input))[0];
  assert.equal(p.damage, 0);
  assert.equal(p.healing, null);
  assert.equal(p.buffs, null);
});
test("permanent counts exclude temporary powerups and incomplete timing stays unknown during replay", () => {
  const input = structuredClone(fixture);
  input.match_info.players[0].power_up_buffs = [
    { is_permanent: true, value: 3, pickup_times_s: [5] },
    { is_permanent: false, value: 99, pickup_times_s: [1] },
  ];
  const match = normalizeMetadata(input);
  assert.equal(playersAt(match)[0].buffs, 3);
  assert.equal(playersAt(match, 10)[0].buffs, null);
});
test("wrong IDs, duplicate players, bad IDs and unusable metadata are rejected", () => {
  for (const value of [
    "",
    "0",
    "12/34",
    "https://example.com/123",
    "1e8",
    "-1",
    "9007199254740992",
  ])
    assert.throws(() => parseMatchId(value));
  assert.equal(parseMatchId(" 120513539 "), "120513539");
  assert.throws(() => normalizeMetadata(fixture, "123"), /different match/);
  assert.throws(() => normalizeMetadata({}), /not available/);
  const input = structuredClone(fixture);
  input.match_info.players[1].account_id =
    input.match_info.players[0].account_id;
  assert.throws(() => normalizeMetadata(input), /duplicate/);
});
test("OBS link opens independently of local storage with Arabic names and recorded frame", () => {
  const panel = cleanPanel({
    metric: "buffs",
    title: "تعزيزات دائمة",
    teamNames: ["فريق أ", "Team B"],
    names: { 3: "اسم اللاعب" },
    layout: "teams",
    theme: "ink",
  });
  const link = panelUrl(
    "https://dlar-draft.vercel.app/",
    sample(),
    panel,
    { event: "Community Cup" },
    600,
  );
  const decoded = readPanelUrl(link);
  assert.deepEqual(decoded.panel, panel);
  assert.equal(decoded.id, "120513539");
  assert.equal(decoded.mode, "finished");
  assert.equal(decoded.time, 600);
  assert.equal(decoded.event, "Community Cup");
  assert.equal(new URL(link).searchParams.get("view"), "stats");
  assert.equal(
    readPanelUrl(panelUrl("https://draft.example", sample(), panel)).time,
    null,
  );
});
test("template cleaning bounds strings, strips unknown fields and handles corrupt links", () => {
  const panel = cleanPanel({
    metric: "constructor",
    scale: 999,
    theme: "evil",
    names: { "bad/key": "x", 5: "x".repeat(500) },
    ownerToken: "secret",
  });
  assert.equal(panel.metric, "damage");
  assert.equal(panel.scale, 2);
  assert.equal(panel.theme, "parchment");
  assert.equal(panel.names[5].length, 48);
  assert.equal(panel.ownerToken, undefined);
  assert.equal(panel.names["bad/key"], undefined);
  assert.equal(
    readPanelUrl("https://draft.example/?view=stats&match=123#panel=%7Bbroken")
      .panel.metric,
    "damage",
  );
});
test("ranking is deterministic, includes unknowns last and team layout keeps teams separate", () => {
  const rows = [
    { id: "1", slot: 1, team: 0, damage: null },
    { id: "2", slot: 2, team: 1, damage: 10 },
    { id: "3", slot: 3, team: 0, damage: 0 },
  ];
  assert.deepEqual(
    sortPlayers(rows, cleanPanel()).map((p) => p.id),
    ["2", "3", "1"],
  );
  assert.deepEqual(
    sortPlayers(rows, cleanPanel({ layout: "teams" })).map((p) => p.id),
    ["3", "1", "2"],
  );
  assert.equal(rows[0].id, "1");
});
test("profile lookup uses only broadcast names; profile personal fields are discarded", () => {
  const match = applyProfileNames(sample(), [
    {
      account_id: 3,
      personaname: "Player Name",
      realname: "private",
      friends: [4],
      countrycode: "XX",
    },
  ]);
  assert.equal(match.players[0].name, "Player Name");
  assert.equal(JSON.stringify(match).includes("private"), false);
  assert.equal(JSON.stringify(match).includes("countrycode"), false);
});
test("metadata errors and profile lookup failures preserve truthful states", async () => {
  const failed = async () => ({ ok: false, status: 429 });
  await assert.rejects(
    loadFinishedMatch("123", new AbortController().signal, failed),
    /rate limited/,
  );
  let call = 0;
  const fetcher = async () =>
    ++call === 1
      ? { ok: true, json: async () => fixture }
      : Promise.reject(Error("profiles unavailable"));
  const match = await loadFinishedMatch(
    "120513539",
    new AbortController().signal,
    fetcher,
  );
  assert.equal(match.players.length, 12);
});
test("live updates merge partial rows, retain zeros and reject older ticks", () => {
  let rows = reduceLiveRow(new Map(), {
    entity_index: 10,
    tick: 2,
    steam_id: "76561197960265851",
    team: 2,
    hero_id: 31,
    damage: 42,
    player_name: "Player",
  });
  rows = reduceLiveRow(rows, {
    entity_index: 10,
    tick: 3,
    damage: 0,
    healing: 12,
  });
  rows = reduceLiveRow(rows, { entity_index: 10, tick: 1, damage: 99 });
  const [p] = livePlayers(rows);
  assert.equal(p.id, "123");
  assert.equal(p.damage, 0);
  assert.equal(p.healing, 12);
  assert.equal(p.team, 0);
  assert.equal(p.buffs, null);
  assert.equal(
    livePlayers(
      reduceLiveRow(rows, { entity_index: 10, tick: 4, delta_type: "delete" }),
    ).length,
    1,
  );
});
test("live identity deduplicates reconnects and never carries old occupant stats into a reused entity", () => {
  let rows = reduceLiveRow(new Map(), {
    entity_index: 1,
    tick: 1,
    steam_id: "123",
    team: 2,
    hero_id: 31,
    damage: 100,
  });
  rows = reduceLiveRow(rows, {
    entity_index: 2,
    tick: 2,
    steam_id: "123",
    team: 2,
    hero_id: 31,
    damage: 110,
  });
  assert.equal(livePlayers(rows).length, 1);
  assert.equal(livePlayers(rows)[0].damage, 110);
  rows = reduceLiveRow(rows, {
    entity_index: 1,
    tick: 3,
    steam_id: "456",
    team: 3,
    hero_id: 19,
  });
  assert.equal(livePlayers(rows).find((p) => p.id === "456").damage, undefined);
});
test("SSE parsing handles split UTF-8 text boundaries, comments, CRLF and multiline event data", () => {
  const events = [],
    parse = createSseParser((e) => events.push(e));
  parse(": heartbeat\r\nevent: sta");
  parse('tus\r\ndata: {"message":\r\ndata: "Starting"}\r\n\r\n');
  parse('data: {"damage":0}\n\nevent: end\ndata: {}\n\n');
  assert.deepEqual(
    events.map((e) => e.event),
    ["status", "message", "end"],
  );
  assert.equal(JSON.parse(events[0].data).message, "Starting");
});
test("live requests target the fixed public endpoint with a streaming projection", async () => {
  const url = new URL(liveQueryUrl("123"));
  assert.equal(url.origin, "https://api.deadlock-api.com");
  assert.equal(url.searchParams.get("match_id"), "123");
  assert.ok(!/GROUP BY|ORDER BY/i.test(url.searchParams.get("query")));
  await assert.rejects(
    streamLiveMatch("123", {
      signal: new AbortController().signal,
      onEvent() {},
      fetcher: async () => ({ ok: false, status: 429 }),
    }),
    /rate limited/,
  );
  await assert.rejects(
    streamLiveMatch("123", {
      signal: new AbortController().signal,
      onEvent() {},
      fetcher: async () =>
        new Response(
          JSON.stringify({ error: "Broadcast has not started yet" }),
          { status: 502 },
        ),
    }),
    /Valve’s spectator relay did not start/,
  );
  await assert.rejects(
    streamLiveMatch("123", {
      signal: new AbortController().signal,
      onEvent() {},
      fetcher: async () => new Response("", { status: 500 }),
    }),
    /API or spectator broadcast may be unavailable/,
  );
  await assert.rejects(
    streamLiveMatch("123", {
      signal: new AbortController().signal,
      onEvent() {},
      fetcher: async () =>
        new Response("{}", { headers: { "Content-Type": "application/json" } }),
    }),
    /did not return/,
  );
  const events = [];
  await streamLiveMatch("123", {
    signal: new AbortController().signal,
    onEvent: (e) => events.push(e),
    fetcher: async () =>
      new Response('data: {"damage":42}\n\nevent: end\ndata: {}\n\n', {
        headers: { "Content-Type": "text/event-stream" },
      }),
  });
  assert.equal(JSON.parse(events[0].data).damage, 42);
  assert.equal(events[1].event, "end");
});

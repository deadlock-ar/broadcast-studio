import test from "node:test";
import assert from "node:assert/strict";
import { metricSupported, cleanPanel } from "../src/stats.js";
import { makeDemo, teamSlots, cleanSnapshot } from "../src/draft.js";
import { applySeriesWin, abilityTier, keyPlayers } from "./enrichment.mjs";
import { initialWorkspace } from "../src/workspace-model.js";
import { reportOutput } from "./reports.mjs";
import { SharedFeeds } from "./feeds.mjs";
test("live recording permanent buffs are supported, while the legacy API keeps its coverage restriction", () => {
  assert.equal(
    metricSupported("buffs", { mode: "live", provider: "local-client-demo" }),
    true,
  );
  assert.equal(
    metricSupported("buffs", { mode: "live", provider: "deadlock-api" }),
    false,
  );
});
test("classic two-ban drafts keep six picks and two bans per side", () => {
  const s = cleanSnapshot(makeDemo(2));
  assert.equal(s.steps.length, 16);
  assert.equal(teamSlots(s, 1, "ban").length, 2);
  assert.equal(teamSlots(s, 2, "pick").length, 6);
  assert.equal(makeDemo(3).steps.length, 18);
});
test("starting another manual draft or loading a rehearsal retains the selected ban format", () => {
  const store = { workspace: initialWorkspace(), saveWorkspace() {} };
  store.workspace.draft.snapshot = makeDemo(2);
  const feeds = new SharedFeeds(store, () => {});
  feeds.connectDraft({ mode: "manual", newDraft: true });
  assert.equal(store.workspace.draft.snapshot.steps.length, 16);
  feeds.connectDraft({ mode: "demo" });
  assert.equal(store.workspace.draft.snapshot.banCount, 2);
});
test("precise panel coordinates and continuous sizes survive validation", () => {
  const p = cleanPanel({
    position: "custom",
    x: 1173,
    y: 619,
    width: 931,
    scale: 1.37,
    fontSize: 21,
  });
  assert.equal(p.x, 1173);
  assert.equal(p.y, 619);
  assert.equal(p.scale, 1.37);
  assert.equal(p.width, 931);
});
test("a game awards exactly one series point and rehearsals award none", () => {
  const store = { workspace: initialWorkspace(), saveWorkspace() {} };
  const s = { id: "123", mode: "local", result: { winner: 1 } };
  assert.equal(applySeriesWin(store, s), true);
  assert.equal(applySeriesWin(store, s), false);
  assert.equal(store.workspace.config.teams[1].score, 1);
  assert.equal(
    applySeriesWin(store, {
      id: "x",
      mode: "rehearsal",
      result: { winner: 0 },
    }),
    false,
  );
});
test("unknown upgrade encodings stay unknown and per-game key players use explicit metrics", () => {
  assert.equal(abilityTier(458752), 2);
  assert.equal(abilityTier(12345), null);
  const p = [
    { id: "1", damage: 10, healing: 1, objectiveDamage: 5 },
    { id: "2", damage: 5, healing: 11, objectiveDamage: 0 },
  ];
  assert.equal(keyPlayers(p).find((p) => p.metric === "healing").playerId, "2");
});
test("two recordings of the same numeric match cannot award two series points", () => {
  const store = {
    workspace: initialWorkspace(),
    sessions: new Map(),
    saveWorkspace() {},
  };
  const a = {
      id: "a",
      mode: "local",
      result: { winner: 0, match: { matchId: "123" } },
    },
    b = { ...a, id: "b" };
  store.sessions.set(a.id, a);
  store.sessions.set(b.id, b);
  assert.equal(applySeriesWin(store, a), true);
  assert.equal(applySeriesWin(store, b), false);
  assert.equal(store.workspace.config.teams[0].score, 1);
});
test("report outputs have independent data and series MVP stays off the scoreboard", () => {
  const w = initialWorkspace();
  w.reports.selectedGames = ["123"];
  w.reports.mvpPlayerId = "1";
  const store = {
    workspace: w,
    archive: { list: () => [] },
    sessions: new Map([
      [
        "123",
        {
          id: "123",
          mode: "local",
          result: {
            match: {
              players: [
                {
                  id: "1",
                  name: "A",
                  heroId: 80,
                  kills: 1,
                  deaths: 0,
                  assists: 2,
                  damage: 50,
                  souls: 100,
                },
              ],
            },
          },
          items: { fromStart: true, purchases: [] },
        },
      ],
    ]),
  };
  const report = reportOutput(store, "series-mvp", [], []);
  assert.equal(report.player.heroId, 80);
  assert.equal(report.visible, true);
  assert.equal(w.scoreboard.matchId, "");
});

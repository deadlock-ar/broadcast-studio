import test from "node:test";
import assert from "node:assert/strict";
import {
  broadcastUrl,
  cleanConfig,
  cleanSnapshot,
  decodeConfig,
  decodeSnapshot,
  makeDemo,
  openDraftConnection,
  parseDraftCode,
  safeImage,
  teamSlots,
} from "../src/draft.js";

test("draft links accept only Statlocker draft rooms", () => {
  assert.equal(
    parseDraftCode(" https://statlocker.gg/draft/VBWWGH17 "),
    "VBWWGH17",
  );
  assert.equal(parseDraftCode("vbwwgh17"), "VBWWGH17");
  for (const bad of [
    "https://statlocker.gg.evil.example/draft/VBWWGH17",
    "https://evil.example/?draft=VBWWGH17",
    "http://statlocker.gg/draft/VBWWGH17",
    "https://statlocker.gg/api",
    "too-short",
  ])
    assert.throws(() => parseDraftCode(bad));
});

test("OBS URL carries Arabic branding and a manual draft without browser storage", () => {
  const config = cleanConfig({
    teams: [{ name: "فريق الزيتون", tag: "AR", score: 2 }, { name: "Kansas" }],
    transparent: true,
    layout: "lower",
  });
  const snapshot = makeDemo();
  const u = new URL(
    broadcastUrl(config, "", false, "https://draft.example", snapshot),
  );
  const fragment = new URLSearchParams(u.hash.slice(1));
  assert.deepEqual(decodeConfig(fragment.get("config")), config);
  assert.deepEqual(
    decodeSnapshot(fragment.get("state")),
    cleanSnapshot(snapshot),
  );
  assert.equal(u.searchParams.get("view"), "overlay");
  const live = new URL(
    broadcastUrl(config, "VBWWGH17", false, "https://draft.example", snapshot),
  );
  assert.equal(live.searchParams.get("draft"), "VBWWGH17");
  assert.equal(new URLSearchParams(live.hash.slice(1)).has("state"), false);
});

test("broadcast state discards participant and owner data and keeps changing ban counts", () => {
  const state = makeDemo();
  state.participants = [{ browserSessionId: "private-session" }];
  state.ownerToken = "private-token";
  state.steps.push({
    id: "fourth-ban",
    teamNumber: 1,
    selectionType: "ban",
    heroId: 88,
  });
  const result = cleanSnapshot(state);
  assert.equal(JSON.stringify(result).includes("private-"), false);
  assert.equal(teamSlots(result, 1, "ban").length, 4);
  assert.equal(teamSlots(result, 1, "ban")[3].heroId, 88);
  assert.equal(teamSlots(result, 2, "pick").length, 6);
});

test("logo input accepts only image data or HTTPS and config values are bounded", () => {
  assert.equal(safeImage("javascript:alert(1)"), "");
  assert.equal(safeImage("data:text/html;base64,YQ=="), "");
  assert.equal(
    safeImage("https://example.com/logo.webp"),
    "https://example.com/logo.webp",
  );
  assert.equal(
    safeImage("data:image/webp;base64,YQ=="),
    "data:image/webp;base64,YQ==",
  );
  const c = cleanConfig({
    teams: [{ score: -5 }, { score: 10000 }],
    game: -10,
    format: "not-a-format",
  });
  assert.equal(c.teams[0].score, 0);
  assert.equal(c.teams[1].score, 99);
  assert.equal(c.game, 1);
  assert.equal(c.format, "BO3");
});

function setup() {
  const sockets = [],
    scheduled = new Map(),
    statuses = [],
    snapshots = [],
    timers = [],
    notices = [],
    initialStates = [];
  let id = 0;
  class Socket {
    constructor(url) {
      this.url = url;
      this.sent = [];
      sockets.push(this);
    }
    send(raw) {
      this.sent.push(JSON.parse(raw));
    }
    close() {
      this.onclose?.();
    }
    receive(data) {
      this.onmessage?.({
        data: typeof data === "string" ? data : JSON.stringify(data),
      });
    }
  }
  const stop = openDraftConnection(
    "VBWWGH17",
    {
      onStatus: (s) => statuses.push(s),
      onSnapshot: (s, { initial }) => {
        snapshots.push(s);
        initialStates.push(initial);
      },
      onTimer: (s) => timers.push(s),
      onNotice: (s) => notices.push(s),
    },
    {
      WebSocket: Socket,
      sessionId: "test-spectator",
      setTimeout: (fn, ms) => {
        scheduled.set(++id, { fn, ms });
        return id;
      },
      clearTimeout: (i) => scheduled.delete(i),
    },
  );
  return {
    sockets,
    scheduled,
    statuses,
    snapshots,
    timers,
    notices,
    initialStates,
    stop,
  };
}

test("spectator protocol receives picks and timers without sending draft decisions", () => {
  const t = setup(),
    socket = t.sockets[0];
  socket.onopen();
  assert.equal(socket.url, "wss://statlocker.gg/ws/draft");
  assert.equal(socket.sent.length, 1);
  assert.equal(socket.sent[0].type, "JOIN_DRAFT");
  assert.equal(socket.sent[0].role, "SPECTATOR");
  assert.equal(socket.sent[0].ownerToken, null);
  socket.receive({ type: "TIMER_UPDATE", timerState: { team1StepTimer: 30 } });
  assert.equal(t.timers.length, 0);
  const draftState = { ...makeDemo(), draftCode: "VBWWGH17" };
  socket.receive({ type: "DRAFT_STATE_UPDATE", draftState });
  socket.receive({ type: "TIMER_UPDATE", timerState: { team1StepTimer: 29 } });
  assert.equal(t.statuses.at(-1).state, "live");
  assert.equal(t.snapshots[0].steps[2].heroId, 6);
  socket.receive({ type: "DRAFT_STATE_UPDATE", draftState });
  assert.deepEqual(t.initialStates, [true, false]);
  assert.equal(t.timers[0].team1StepTimer, 29);
  socket.receive("not-json");
  assert.equal(t.notices.length, 1);
  t.stop();
  assert.equal(t.scheduled.size, 0);
});

test("reconnect keeps the last snapshot and disconnect cancels future updates", () => {
  const t = setup(),
    socket = t.sockets[0];
  socket.onopen();
  socket.receive({
    type: "DRAFT_STATE_UPDATE",
    draftState: { ...makeDemo(), draftCode: "VBWWGH17" },
  });
  socket.close();
  assert.equal(t.snapshots.length, 1);
  assert.equal(t.statuses.at(-1).state, "reconnecting");
  const retry = [...t.scheduled.values()].find((t) => t.ms === 1000);
  assert.ok(retry);
  retry.fn();
  assert.equal(t.sockets.length, 2);
  t.sockets[1].onopen();
  t.sockets[1].receive({
    type: "DRAFT_STATE_UPDATE",
    draftState: { ...makeDemo(), draftCode: "VBWWGH17" },
  });
  assert.deepEqual(t.initialStates, [true, true]);
  t.stop();
  const next = t.sockets[1];
  next.receive({
    type: "DRAFT_STATE_UPDATE",
    draftState: { ...makeDemo(), draftCode: "VBWWGH17" },
  });
  assert.equal(t.snapshots.length, 2);
});

test("a room error stops reconnecting and another room cannot replace the current draft", () => {
  const t = setup();
  t.sockets[0].receive({
    type: "DRAFT_STATE_UPDATE",
    draftState: { ...makeDemo(), draftCode: "OTHER123" },
  });
  assert.equal(t.snapshots.length, 0);
  t.sockets[0].receive({ type: "ERROR", message: "Draft not found" });
  assert.equal(t.statuses.at(-1).state, "error");
  assert.equal(t.scheduled.size, 0);
  t.stop();
});

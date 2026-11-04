import test from "node:test";
import assert from "node:assert/strict";
import {
  createPickTracker,
  createVoicePlayer,
  createPickFlashController,
} from "../src/pick-effects.js";
import {
  cleanConfig,
  encodeConfig,
  decodeConfig,
  makeDemo,
} from "../src/draft.js";
import fs from "node:fs";

function flashHarness() {
  let now = 0,
    id = 0;
  const pending = new Map(),
    states = [];
  const controller = createPickFlashController({
    onChange: (state) => states.push(state),
    schedule: (fn, delay) => {
      pending.set(++id, { fn, at: now + delay });
      return id;
    },
    cancel: (id) => pending.delete(id),
  });
  const advance = (ms) => {
    now += ms;
    for (const [id, task] of [...pending]) {
      if (task.at <= now) {
        pending.delete(id);
        task.fn();
      }
    }
  };
  return { controller, pending, states, advance };
}

test("on-fire lasts six seconds and overlapping team picks expire independently", () => {
  const t = flashHarness();
  t.controller.show("left-1", 1);
  t.advance(2000);
  t.controller.show("right-1", 6);
  t.advance(3999);
  assert.deepEqual(t.states.at(-1), { "left-1": 1, "right-1": 6 });
  t.advance(1);
  assert.deepEqual(t.states.at(-1), { "right-1": 6 });
  t.advance(2000);
  assert.deepEqual(t.states.at(-1), {});
  assert.equal(t.pending.size, 0);
});

test("replacement resets the six-second window and room/reset/dispose cancel stale callbacks", () => {
  const t = flashHarness();
  t.controller.show("slot", 1);
  const stale = [...t.pending.values()][0].fn;
  t.advance(5000);
  t.controller.show("slot", 6);
  stale();
  assert.deepEqual(t.states.at(-1), { slot: 6 });
  t.advance(5999);
  assert.deepEqual(t.states.at(-1), { slot: 6 });
  t.advance(1);
  assert.deepEqual(t.states.at(-1), {});
  t.controller.show("next", 8);
  t.controller.reset();
  assert.deepEqual(t.states.at(-1), {});
  assert.equal(t.pending.size, 0);
  t.controller.show("next", 8);
  const stateCount = t.states.length;
  t.controller.dispose();
  t.advance(6000);
  assert.equal(t.states.length, stateCount);
  assert.equal(t.pending.size, 0);
});

test("only new picks trigger effects, including replacement and clear/re-pick; joins do not replay", () => {
  const tracker = createPickTracker();
  const state = makeDemo();
  assert.deepEqual(tracker.observe(state), []);
  const next = structuredClone(state);
  next.steps[12].heroId = 8;
  assert.deepEqual(
    tracker.observe(next).map((s) => s.heroId),
    [8],
  );
  assert.deepEqual(
    tracker.observe({ ...next, currentTimer: { team1StepTimer: 20 } }),
    [],
  );
  next.steps[0].heroId = 25; // A ban is never a pick voice.
  assert.deepEqual(tracker.observe(next), []);
  next.steps[12].heroId = 50;
  assert.deepEqual(
    tracker.observe(next).map((s) => s.heroId),
    [50],
  );
  next.steps[12].heroId = null;
  assert.deepEqual(tracker.observe(next), []);
  next.steps[12].heroId = 50;
  assert.deepEqual(
    tracker.observe(next).map((s) => s.heroId),
    [50],
  );
  next.steps[13].heroId = 27; // Selection made while disconnected.
  assert.deepEqual(tracker.observe(next, { initial: true }), []);
  next.steps[14].heroId = 31;
  assert.deepEqual(
    tracker.observe(next).map((s) => s.heroId),
    [31],
  );
  tracker.reset();
  assert.deepEqual(tracker.observe(makeDemo()), []);
});

function audioHarness() {
  const plays = [],
    timers = new Map(),
    blocked = [];
  let timerId = 0,
    rejection = null;
  const audio = {
    src: "",
    volume: 0,
    play() {
      plays.push(this.src);
      return rejection ? Promise.reject(rejection) : Promise.resolve();
    },
    pause() {},
    removeAttribute() {},
  };
  const player = createVoicePlayer({
    createAudio: () => audio,
    schedule: (fn, delay) => {
      timers.set(++timerId, { fn, delay });
      return timerId;
    },
    cancel: (id) => timers.delete(id),
    onBlocked: (value) => blocked.push(value),
  });
  return {
    player,
    audio,
    plays,
    timers,
    blocked,
    reject: (e) => {
      rejection = e;
    },
  };
}

test("voice lines play sequentially, recover from missing audio, and stop on mute", async () => {
  const t = audioHarness();
  t.player.enqueue("muted");
  assert.equal(t.plays.length, 0);
  t.player.configure({ enabled: true, volume: 0.35 });
  t.player.enqueue("first");
  t.player.enqueue("second");
  t.player.enqueue("third");
  assert.deepEqual(t.plays, ["first"]);
  assert.equal(t.audio.volume, 0.35);
  t.audio.onended();
  assert.deepEqual(t.plays, ["first", "second"]);
  t.audio.onerror();
  assert.deepEqual(t.plays, ["first", "second", "third"]);
  const watchdog = [...t.timers.values()][0];
  assert.equal(watchdog.delay, 10000);
  watchdog.fn();
  t.player.configure({ enabled: false, volume: 0.35 });
  t.player.enqueue("ignored");
  assert.equal(t.plays.length, 3);
  t.player.dispose();
  assert.equal(t.timers.size, 0);
});

test("autoplay rejection drops pending clips and gesture unlock allows future picks", async () => {
  const t = audioHarness();
  t.player.configure({ enabled: true, volume: 0.7 });
  t.reject(
    Object.assign(new Error("Gesture needed"), { name: "NotAllowedError" }),
  );
  t.player.enqueue("old-pick");
  t.player.enqueue("queued-old-pick");
  await Promise.resolve();
  assert.deepEqual(t.blocked, [true]);
  assert.equal(t.timers.size, 0);
  t.reject(null);
  assert.equal(await t.player.unlock(), true);
  t.player.enqueue("new-pick");
  assert.equal(t.plays.at(-1), "new-pick");
  assert.equal(t.plays.includes("queued-old-pick"), false);
  t.player.dispose();
});

test("effects settings survive old backups, OBS links, and bounded volume input", () => {
  assert.equal(cleanConfig({}).voiceVolume, 70);
  const config = cleanConfig({
    voiceLines: false,
    pickEffects: false,
    voiceVolume: 150,
  });
  assert.equal(config.voiceVolume, 100);
  assert.deepEqual(decodeConfig(encodeConfig(config)), config);
});

test("every current hero has gloat, critical, and genuine selection audio metadata", () => {
  const heroes = JSON.parse(
    fs.readFileSync(new URL("../src/heroes.json", import.meta.url)),
  );
  assert.ok(heroes.length >= 44);
  for (const hero of heroes) {
    assert.match(
      hero.gloatImage,
      /^\/heroes\/\d+-gloat\.webp$/,
    );
    assert.match(
      hero.criticalImage,
      /^\/heroes\/\d+-critical\.webp$/,
    );
    assert.ok(hero.voiceLines.length, hero.name + " needs a selection clip");
    for (const url of hero.voiceLines)
      assert.match(url, /^(https:\/\/cdn\.(goonlock|vlviewer)\.com\/.*|\/voices\/\d+-select-\d+)\.mp3$/);
    for(const asset of [hero.image,hero.gloatImage,hero.criticalImage,...hero.voiceLines.filter(v=>v.startsWith('/'))]) assert.ok(fs.statSync(new URL('../public'+asset,import.meta.url)).size>100,`${hero.name} missing ${asset}`);
  }
});

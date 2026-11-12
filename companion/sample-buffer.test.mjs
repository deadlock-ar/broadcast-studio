import test from "node:test";
import assert from "node:assert/strict";
import { SampleBuffer } from "./sample-buffer.mjs";

test("bursty source samples survive partial acknowledgements and repeated sends", () => {
  const buffer = new SampleBuffer();
  for (let tick = 0; tick < 40; tick++)
    buffer.push({
      frame: { tick },
      sourceClockMs: tick * 250,
      items: { large: true },
    });
  const first = buffer.batch();
  assert.equal(first.length, 32);
  assert.deepEqual(buffer.batch(), first);
  assert.equal(first[0].sample.items, undefined);
  buffer.acknowledge(first.at(-1).id);
  assert.deepEqual(
    buffer.batch().map((entry) => entry.sample.frame.tick),
    [32, 33, 34, 35, 36, 37, 38, 39],
  );
});
test("overflow is bounded and an old-run acknowledgement cannot consume a new run", () => {
  const buffer = new SampleBuffer(4);
  for (let tick = 0; tick < 10; tick++) buffer.push({ frame: { tick } });
  assert.equal(buffer.length, 4);
  assert.equal(buffer.dropped, 6);
  assert.equal(buffer.batch()[0].sample.timingReset, true);
  const oldGeneration = buffer.generation;
  buffer.clear();
  buffer.push({ frame: { tick: 100 } });
  buffer.acknowledge(10, oldGeneration);
  assert.equal(buffer.length, 1);
  buffer.acknowledge(1, buffer.generation);
  assert.equal(buffer.length, 0);
});

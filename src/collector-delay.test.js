import test from "node:test";
import assert from "node:assert/strict";
import { enqueueCollectorState } from "./collector.js";

test("one-second momentum buckets retain a full two-minute delay through event bursts", () => {
  let queue = [];
  for (let now = 0; now < 120000; now += 10)
    queue = enqueueCollectorState(
      queue,
      { sourceTime: now },
      now,
      120000,
      1000,
    );
  assert.equal(queue.length, 120);
  assert.equal(queue[0].at, 120990);
  assert.equal(queue.at(-1).value.sourceTime, 119990);
  // A consumer still receives the first measured second after its full delay.
  assert.equal(queue[0].at - queue[0].value.sourceTime, 120000);
});

test("momentum queue uses the smaller cadence-based bound and keeps newest snapshots", () => {
  let queue = [];
  for (let now = 0; now < 500000; now += 1000)
    queue = enqueueCollectorState(
      queue,
      { sourceTime: now },
      now,
      120000,
      1000,
    );
  assert.equal(queue.length, 220);
  assert.equal(queue[0].value.sourceTime, 280000);
  assert.equal(queue.at(-1).value.sourceTime, 499000);
});

test("the existing default ten-Hz queue and invalid-cadence fallback remain bounded", () => {
  for (const cadence of [undefined, 0, NaN]) {
    let queue = [];
    for (let now = 0; now < 200000; now += 100)
      queue = enqueueCollectorState(
        queue,
        { sourceTime: now },
        now,
        120000,
        cadence,
      );
    assert.equal(queue.length, 1300);
    assert.equal(queue.at(-1).value.sourceTime, 199900);
  }
});

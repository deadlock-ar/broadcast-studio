import { mkdtemp, readFile, open, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as wait } from "node:timers/promises";
import assert from "node:assert/strict";
import { collectLocal } from "../collector/local-reader.mjs";
const bytes = await readFile(process.argv[2]);
const directory = await mkdtemp(path.join(tmpdir(), "dlar-growing-")),
  file = path.join(directory, "capture.dem");
let written = 0,
  samplesWhileGrowing = 0,
  samples = 0;
const sizes = new Set();
const reader = collectLocal({ file, fromStart: false }, (value) => {
  if (value.frame) {
    samples++;
    sizes.add(value.bytes);
    if (written < bytes.length) samplesWhileGrowing++;
  }
});
const handle = await open(file, "wx");
try {
  for (let offset = 0; offset < bytes.length; offset += 181703) {
    const chunk = bytes.subarray(offset, offset + 181703);
    await handle.write(chunk);
    written += chunk.length;
    await wait(10);
  }
} finally {
  await handle.close();
}
const result = await reader;
assert.ok(samplesWhileGrowing > 10);
assert.ok(sizes.size > 10);
assert.equal(result.ended, false);
assert.equal(result.bytes, bytes.length);
console.log(
  JSON.stringify({
    samples,
    samplesWhileGrowing,
    distinctReadSizes: sizes.size,
    recordingEndedWithoutGameOver: !result.ended,
    bytes: result.bytes,
  }),
);
await rm(directory, { recursive: true, force: true });

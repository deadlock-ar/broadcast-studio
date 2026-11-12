// Keep source samples through bursty recording writes and HTTP retries. Items
// and audit history travel once per packet, rather than once per sample.
export class SampleBuffer {
  constructor(limit = 512) {
    this.limit = limit;
    this.clear();
  }
  clear() {
    this.generation = (this.generation || 0) + 1;
    this.entries = [];
    this.serial = 0;
    this.dropped = 0;
  }
  get length() {
    return this.entries.length;
  }
  push(value) {
    if (!value?.frame) return;
    const {
      frame,
      effects,
      hits,
      decodedAt,
      readAt,
      fileModifiedAt,
      sourceClockMs,
    } = value;
    this.entries.push({
      id: ++this.serial,
      sample: structuredClone({
        frame,
        effects,
        hits,
        decodedAt,
        readAt,
        fileModifiedAt,
        sourceClockMs,
      }),
    });
    if (this.entries.length > this.limit) {
      this.dropped += this.entries.length - this.limit;
      this.entries.splice(0, this.entries.length - this.limit);
      this.entries[0].sample.timingReset = true;
    }
  }
  batch(limit = 32) {
    return this.entries.slice(0, limit);
  }
  acknowledge(id, generation = this.generation) {
    if (generation === this.generation)
      this.entries = this.entries.filter((entry) => entry.id > id);
  }
}

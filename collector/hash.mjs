export function murmur2(text, seed = 0x31415926) {
  const bytes = Buffer.from(text);
  let h = (seed ^ bytes.length) >>> 0;
  let i = 0;
  for (; i + 4 <= bytes.length; i += 4) {
    let k = bytes.readUInt32LE(i);
    k = Math.imul(k, 0x5bd1e995);
    k ^= k >>> 24;
    k = Math.imul(k, 0x5bd1e995);
    h = (Math.imul(h, 0x5bd1e995) ^ k) >>> 0;
  }
  const remaining = bytes.length - i;
  if (remaining >= 3) h ^= bytes[i + 2] << 16;
  if (remaining >= 2) h ^= bytes[i + 1] << 8;
  if (remaining >= 1) h = Math.imul(h ^ bytes[i], 0x5bd1e995);
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  return (h ^ (h >>> 15)) >>> 0;
}

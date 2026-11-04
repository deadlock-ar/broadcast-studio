import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import { Readable } from "node:stream";
import { createZstdDecompress } from "node:zlib";
import { setTimeout as delay } from "node:timers/promises";
import unbzip2 from "unbzip2-stream";
import { broadcastUrl } from "./model.mjs";

export async function fetchJson(url, signal) {
  const response = await fetch(url, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
  });
  if (!response.ok)
    throw Error(
      `Source HTTP ${response.status}${response.status === 429 ? " · rate limited; wait before retrying" : ""}`,
    );
  return response.json();
}
export async function resolveBroadcast(id, manual, signal) {
  if (manual) return broadcastUrl(manual, id);
  const value = await fetchJson(
    `https://api.deadlock-api.com/v1/matches/${id}/live/url`,
    signal,
  );
  return (
    broadcastUrl(typeof value === "string" ? value : value.broadcast_url, id) ||
    (() => {
      throw Error("No Valve broadcast URL was returned.");
    })()
  );
}
export async function* liveFragments(url, signal, progress, atEdge) {
  const get = async (path, json = false) => {
    const response = await fetch(`${url}/${path}`, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
    });
    if (!response.ok)
      throw Error(
        `Valve relay HTTP ${response.status}${response.status === 404 ? " · broadcast unavailable or not started" : ""}`,
      );
    return json ? response.json() : Buffer.from(await response.arrayBuffer());
  };
  let sync = await get("sync", true),
    fragment = Math.max(1, sync.fragment - 2);
  let lastProgress = Date.now();
  progress(
    `Valve relay connected · reported delay ${Math.round(sync.rtdelay ?? 0)}s`,
  );
  yield await get(`${sync.signup_fragment}/start`);
  yield await get(`${fragment}/full`);
  while (!signal.aborted) {
    if (Date.now() - lastProgress > 45000)
      throw Error(
        "Valve stopped sending new broadcast fragments. Last values retained.",
      );
    if (fragment > sync.fragment) {
      await delay(1000, undefined, { signal });
      sync = await get("sync", true);
      continue;
    }
    if (fragment >= sync.fragment) atEdge();
    yield await get(`${fragment}/delta`);
    fragment++;
    lastProgress = Date.now();
  }
}
export async function replayStream(id, file, signal) {
  let input, magic;
  if (file) {
    const descriptor = await open(file, "r");
    magic = Buffer.alloc(4);
    await descriptor.read(magic, 0, 4, 0);
    await descriptor.close();
    input = createReadStream(file);
  } else {
    const salts = await fetchJson(
      `https://api.deadlock-api.com/v1/matches/${id}/salts`,
      signal,
    );
    if (!salts.demo_url)
      throw Error("The replay is unavailable. Use a recent finished match.");
    const url = new URL(salts.demo_url);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !/^replay\d+\.valve\.net$/.test(url.hostname) ||
      url.port ||
      url.username ||
      !url.pathname.startsWith(`/1422450/${id}_`)
    )
      throw Error("Unexpected Valve replay URL.");
    // Limit connection setup, not playback: a 1x replay can run for an hour.
    const connection = new AbortController();
    const timeout = setTimeout(() => connection.abort(), 30000);
    let response;
    try {
      response = await fetch(url, {
        signal: AbortSignal.any([signal, connection.signal]),
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) throw Error(`Replay HTTP ${response.status}`);
    const reader = response.body.getReader();
    const first = await reader.read();
    if (first.done) throw Error("Empty replay");
    magic = Buffer.from(first.value.slice(0, 4));
    input = Readable.from(
      (async function* () {
        yield first.value;
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          yield chunk.value;
        }
      })(),
    );
  }
  if (magic.toString("ascii", 0, 4) === "PBDE") return input;
  const decode =
    magic.toString("hex") === "28b52ffd"
      ? createZstdDecompress()
      : magic.toString("ascii", 0, 3) === "BZh"
        ? unbzip2()
        : null;
  if (!decode) {
    input.destroy();
    throw Error("Unsupported replay compression.");
  }
  input.on("error", (error) => decode.destroy(error));
  signal.addEventListener(
    "abort",
    () => {
      input.destroy();
      decode.destroy();
    },
    { once: true },
  );
  return input.pipe(decode);
}

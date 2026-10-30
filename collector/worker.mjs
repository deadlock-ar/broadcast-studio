import { parentPort, workerData } from "node:worker_threads";
import { readFileSync } from "node:fs";
import { Readable } from "node:stream";
import { setTimeout as wait } from "node:timers/promises";
import {
  Parser,
  ParserConfiguration,
  Logger,
  InterceptorStage,
  MessagePacketType,
  DemoSource,
} from "deadem";
import { readFrame } from "./extract.mjs";
import { ultimateEffects, ultimateHit } from "./ultimates.mjs";
import { liveFragments, replayStream, resolveBroadcast } from "./sources.mjs";

const options = workerData;
const pickups = JSON.parse(
  readFileSync(new URL("./data/permanent-pickups.json", import.meta.url)),
);
const ultimates = JSON.parse(
  readFileSync(new URL("./data/ultimates.json", import.meta.url)),
);
const send = (type, data) => parentPort.postMessage({ type, ...data });
let broadcast;
for (
  let attempt = 0;
  attempt < (options.mode === "replay" ? 1 : 5);
  attempt++
) {
  const abort = new AbortController();
  const parser = new Parser(
    new ParserConfiguration({
      entityClasses: [
        "CCitadelPlayerController",
        "CCitadelPlayerPawn",
        "CCitadelGameRulesProxy",
      ],
    }),
    Logger.CONSOLE_WARN,
  );
  const demo = parser.getDemo();
  let serverTick = null,
    lastSample = -Infinity,
    endObserved = false,
    winner = null,
    liveEdge = options.mode === "replay",
    replayStarted = false;
  let latest = null,
    sealed = false;
  const hitTimes = new Map();
  parser.registerPostInterceptor(
    InterceptorStage.MESSAGE_PACKET,
    (outer, packet) => {
      if (packet.type === MessagePacketType.SVC_PACKET_ENTITIES)
        serverTick = packet.data.serverTick ?? serverTick;
      if (
        packet.type === MessagePacketType.CITADEL_USER_MESSAGE_GAME_OVER &&
        packet.data.justATest !== true
      ) {
        endObserved = true;
        const value = packet.data.winningTeam;
        if ([2, 3].includes(value)) winner = value - 2;
      }
      if (
        liveEdge &&
        (options.mode !== "replay" || replayStarted) &&
        packet.type === MessagePacketType.CITADEL_USER_MESSAGE_DAMAGE
      ) {
        const hit = ultimateHit(demo, packet.data, ultimates);
        if (hit && outer.tick - (hitTimes.get(hit.key) ?? -Infinity) > 24) {
          hitTimes.set(hit.key, outer.tick);
          send("hit", { hit });
        }
      }
    },
  );
  parser.registerPostInterceptor(InterceptorStage.DEMO_PACKET, (packet) => {
    if (sealed) return;
    if (packet.tick < 0 || (!endObserved && packet.tick < lastSample + 16))
      return;
    lastSample = packet.tick;
    const frame = readFrame(
      demo,
      pickups,
      packet.tick,
      serverTick,
      endObserved,
      winner,
    );
    if (!frame.players.length) return;
    latest = frame;
    if (
      options.mode === "replay" &&
      (frame.duration ?? 0) < (options.replayFrom ?? 0) &&
      !frame.endObserved
    )
      return;
    replayStarted = true;
    send("frame", { frame, effects: ultimateEffects(demo, ultimates) });
    if (frame.endObserved) {
      endObserved = true;
      sealed = true;
      return;
    }
    if (options.mode === "replay" && options.replaySpeed > 0) {
      parser.pause();
      setTimeout(() => {
        if (!parser.getIsDisposed()) parser.resume();
      }, 250 / options.replaySpeed);
    }
  });
  try {
    let reader;
    if (options.mode === "replay")
      reader = await replayStream(options.id, options.replayFile, abort.signal);
    else {
      broadcast ||= await resolveBroadcast(
        options.id,
        options.broadcastUrl,
        abort.signal,
      );
      const source = liveFragments(
        broadcast,
        abort.signal,
        (message) => send("status", { status: "connecting", message }),
        () => {
          liveEdge = true;
        },
      );
      reader = Readable.from(
        (async function* () {
          for await (const chunk of source) {
            yield chunk;
            if (endObserved) break;
          }
        })(),
      );
    }
    await parser.parse(
      reader,
      options.mode === "replay" ? DemoSource.REPLAY : DemoSource.HTTP_BROADCAST,
    );
    if (latest?.endObserved) {
      send("ended", {});
      break;
    }
    throw Error(
      "The feed ended without a game-over signal. Results remain incomplete.",
    );
  } catch (error) {
    if (latest?.endObserved) {
      send("ended", {});
      break;
    }
    const retrying =
      options.mode !== "replay" && attempt < 4 && Boolean(broadcast);
    send("status", {
      status: retrying ? "reconnecting" : "interrupted",
      message: `${error.message}${retrying ? " · retrying the same relay" : ""}`,
    });
    if (!retrying) break;
    await wait(Math.min(15000, 2000 * 2 ** attempt));
  } finally {
    abort.abort();
    await parser.dispose();
  }
}

import {
  Parser,
  ParserConfiguration,
  Logger,
  InterceptorStage,
  MessagePacketType,
  StringTableType,
} from "deadem";
import {
  readFile,
  open,
  stat,
  mkdir,
  writeFile,
  rename,
} from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { setTimeout as wait } from "node:timers/promises";
import { installPovSupport } from "./pov-compat.mjs";
import { readFrame, playerFor } from "./extract.mjs";
import { ultimateHit, ultimateEffects } from "./ultimates.mjs";
import { PurchaseLedger } from "./purchases.mjs";
import { enrichFrame } from "./enrichment.mjs";

const load = async (name) =>
  JSON.parse(
    await readFile(new URL(`./data/${name}.json`, import.meta.url), "utf8"),
  );
export async function collectLocal(options, publish, signal) {
  const [pickups, ultimates, bridges, items, signatures] = await Promise.all(
    [
      "permanent-pickups",
      "ultimates",
      "bridge-buffs",
      "items",
      "signatures",
    ].map(load),
  );
  const parser = new Parser(new ParserConfiguration(), Logger.CONSOLE_WARN);
  const compatibility = await installPovSupport(parser),
    demo = parser.getDemo(),
    ledger = new PurchaseLedger(items);
  let serverTick = null,
    lastSample = -Infinity,
    lastTick = null,
    ended = false,
    winner = null,
    stopped = false,
    readAt = null,
    bytes = 0,
    fileIdentity = null,
    descriptor = null,
    order = 0;
  const hits = [],
    audit = [];
  const hitTimes = new Map();
  let fromStart = options.fromStart === true,
    firstFrame = true;
  const actors = () =>
    new Map(
      demo
        .getEntitiesByClassName("CCitadelPlayerController")
        .map((controller) => {
          const player = playerFor(demo, controller, true),
            pawn = demo.getEntityByHandle(controller.getField("m_hHeroPawn"));
          // Notification userid and purchaser_player_slot are zero-based lobby slots.
          return [
            controller.getField("m_unLobbyPlayerSlot") - 1,
            player
              ? {
                  ...player,
                  controller: undefined,
                  refundable: pawn?.getField("m_vecFullSellPriceItems"),
                }
              : null,
          ];
        })
        .filter(([, p]) => p),
    );
  const sample = (tick, force = false) => {
    ledger.flush(tick, actors(), ended);
    const interval = demo.server?.tickInterval;
    if (
      !force &&
      tick - lastSample <
        (interval ? Math.max(1, Math.round(0.25 / interval)) : 8)
    )
      return;
    const frame = readFrame(demo, pickups, tick, serverTick, ended, winner, {
      includeBots: true,
    });
    if (!frame.players.length) return;
    enrichFrame(demo, frame, signatures, items);
    if (frame.endObserved && !ended) {
      ended = true;
      ledger.flush(tick, actors(), true);
    }
    if (firstFrame) {
      if (frame.duration === null || frame.duration > 0) fromStart = false;
      firstFrame = false;
    }
    lastSample = tick;
    const table = demo.stringTableContainer.getByType(
      StringTableType.ACTIVE_MODIFIERS,
    );
    for (const player of frame.players) {
      const controller = demo
        .getEntitiesByClassName("CCitadelPlayerController")
        .find((c) => c.getField("m_unLobbyPlayerSlot") === player.slot);
      const pawn = demo.getEntityByHandle(controller?.getField("m_hHeroPawn"));
      player.bridgeBuffs =
        table && pawn
          ? [...table.getEntries()]
              .filter(
                (e) =>
                  e.value?.entryType === 1 && e.value.parent === pawn.handle,
              )
              .flatMap((e) => {
                const b = bridges.entries.find(
                  (b) => b.id === e.value.modifierSubclass,
                );
                return b
                  ? [
                      {
                        id: b.id,
                        label: b.label,
                        remaining:
                          Number.isFinite(e.value.lastAppliedTime) &&
                          Number.isFinite(e.value.duration) &&
                          interval &&
                          serverTick !== null
                            ? Math.max(
                                0,
                                e.value.lastAppliedTime +
                                  e.value.duration -
                                  serverTick * interval,
                              )
                            : null,
                      },
                    ]
                  : [];
              })
          : null;
    }
    publish({
      frame,
      effects: ultimateEffects(demo, ultimates, { includeBots: true }),
      hits: hits.filter((h) => Date.now() - h.at < 5000),
      items: ledger.snapshot(fromStart),
      audit,
      decodedAt: Date.now(),
      readAt,
      bytes,
      compatibility,
    });
  };
  parser.registerPostInterceptor(
    InterceptorStage.MESSAGE_PACKET,
    (outer, packet) => {
      const data = packet.data;
      if (packet.type === MessagePacketType.SVC_PACKET_ENTITIES)
        serverTick = data.serverTick ?? serverTick;
      if (
        packet.type === MessagePacketType.CITADEL_USER_MESSAGE_GAME_OVER &&
        data.justATest !== true
      ) {
        ended = true;
        if ([2, 3].includes(data.winningTeam)) winner = data.winningTeam - 2;
      }
      if (
        packet.type ===
        MessagePacketType.CITADEL_USER_MESSAGE_ITEM_PURCHASE_NOTIFICATION
      )
        ledger.record({
          type: "notification",
          user: data.userid,
          itemId: data.abilityId,
          sell: data.sell === true,
          order: order++,
        });
      if (
        packet.type ===
          MessagePacketType.CITADEL_USER_MESSAGE_ABILITY_CHANGED &&
        ["EPurchased", "ESold"].includes(data.change)
      )
        ledger.record({
          type: "change",
          user: data.purchaserPlayerSlot,
          itemId: data.abilityId,
          sell: data.change === "ESold",
          order: order++,
        });
      if (
        packet.type === MessagePacketType.CITADEL_USER_MESSAGE_CURRENCY_CHANGED
      )
        ledger.record({
          type: "currency",
          user: data.userid,
          currencyType: data.currencyType,
          delta: data.delta,
          order: order++,
        });
      if (packet.type === MessagePacketType.CITADEL_USER_MESSAGE_DAMAGE) {
        const hit = ultimateHit(demo, data, ultimates, { includeBots: true });
        if (
          hit &&
          outer.tick - (hitTimes.get(hit.key) ?? -Infinity) >
            (demo.server?.tickInterval ? 0.5 / demo.server.tickInterval : 16)
        ) {
          hitTimes.set(hit.key, outer.tick);
          hits.push({ ...hit, at: Date.now(), sourceTick: serverTick });
          if (hits.length > 40) hits.shift();
        }
      }
    },
  );
  parser.registerPostInterceptor(InterceptorStage.DEMO_PACKET, (packet) => {
    if (packet.type.id === 9) {
      audit.push({
        tick: packet.tick,
        command: String(
          packet.data.command || packet.data.cmd || JSON.stringify(packet.data),
        ).slice(0, 500),
      });
      if (audit.length > 500) audit.shift();
    }
    if (packet.type.id === 0) stopped = true;
    if (packet.type.id !== 7 || packet.tick < 0) return;
    lastTick = packet.tick;
    sample(packet.tick, ended);
  });
  async function* follow() {
    try {
      while (!signal?.aborted && !stopped) {
        let info;
        try {
          info = await stat(options.file);
        } catch (e) {
          if (e.code !== "ENOENT") throw e;
          if (options.fixture) throw e;
          await wait(100);
          continue;
        }
        const identity = `${info.dev}:${info.ino}:${info.birthtimeMs}`;
        if (fileIdentity && identity !== fileIdentity)
          throw Error("Recording file was replaced. Start a new game capture.");
        fileIdentity = identity;
        if (info.size < bytes)
          throw Error(
            "Recording file was truncated. Start a new game capture.",
          );
        descriptor ??= await open(options.file, "r");
        if (info.size === bytes) {
          if (options.fixture) break;
          await wait(100);
          continue;
        }
        const chunk = Buffer.alloc(Math.min(65536, info.size - bytes));
        const result = await descriptor.read(chunk, 0, chunk.length, bytes);
        if (!result.bytesRead) {
          await wait(100);
          continue;
        }
        bytes += result.bytesRead;
        readAt = Date.now();
        yield chunk.subarray(0, result.bytesRead);
      }
    } finally {
      await descriptor?.close();
    }
  }
  try {
    await parser.parse(
      Readable.from(follow(), { objectMode: false, highWaterMark: 1 }),
    );
    if (lastTick !== null) sample(lastTick, true);
  } finally {
    publish({
      stopped: true,
      decodedAt: Date.now(),
      items: ledger.snapshot(fromStart),
      audit,
    });
  }
  return { ended, stopped, bytes, compatibility };
}

export async function saveJournal(directory, value) {
  await mkdir(directory, { recursive: true });
  const target = path.join(directory, "latest.json");
  await writeFile(target + ".tmp", JSON.stringify(value), { mode: 0o600 });
  await rename(target + ".tmp", target);
}

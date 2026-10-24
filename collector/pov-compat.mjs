// Client-demo adapter for the pinned Deadem 4.0.2 parser. Relay parsing does
// not install this adapter. Fail closed on unsupported baseline formats.
// Entity handling follows Deadem 4.0.2 (MIT, Igor Losev), with two baseline
// banks as used by DemoFile.Net. Unsupported formats still fail explicitly.
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import {
  Entity,
  EntityOperation,
  InterceptorStage,
  MessagePacketType,
} from "deadem";

export async function installPovSupport(parser) {
  const require = createRequire(import.meta.resolve("deadem"));
  const root = new URL(
    "./src/",
    pathToFileURL(require.resolve("@deademx/engine")),
  );
  const module = (path) => import(new URL(path, root));
  const [
    { default: BitBuffer },
    { default: EntityMutationExtractor },
    { default: EntityMutationBatch },
    { default: EntityPayloadSizeExtractor },
  ] = await Promise.all([
    module("core/BitBuffer.js"),
    module("extractors/EntityMutationExtractor.js"),
    module("data/entity/EntityMutationBatch.js"),
    module("extractors/EntityPayloadSizeExtractor.js"),
  ]);
  const banks = [new Map(), new Map()];
  const diagnostics = {
    clearOrderingRepairs: 0,
    baselinePackets: 0,
    cachedBaselineCreates: 0,
  };
  parser.registerPreInterceptor(InterceptorStage.DEMO_PACKET, (packet) => {
    const messages = packet.data?.messagePackets;
    if (
      !messages?.some(
        (m) => m.type === MessagePacketType.SVC_CLEAR_ALL_STRING_TABLES,
      )
    )
      return;
    // The upstream prioritizer puts creates before clears inside sign-on packets.
    // Clear must run first or the create metadata is lost before the POV snapshot.
    if (
      messages.findIndex(
        (m) => m.type === MessagePacketType.SVC_CLEAR_ALL_STRING_TABLES,
      ) > 0
    )
      diagnostics.clearOrderingRepairs++;
    messages.sort(
      (a, b) =>
        Number(b.type === MessagePacketType.SVC_CLEAR_ALL_STRING_TABLES) -
        Number(a.type === MessagePacketType.SVC_CLEAR_ALL_STRING_TABLES),
    );
    banks.forEach((bank) => bank.clear());
  });
  const handler = parser._engine.getDemoMessageHandler();
  handler.handleSvcPacketEntities = function (
    packet,
    startPointer = 0,
    startLoop = 0,
    startIndex = -1,
    direct = false,
  ) {
    if (!direct || startPointer || startLoop || startIndex !== -1)
      throw Error(
        "Experimental POV probe requires direct, sequential parsing.",
      );
    const message = packet.data,
      demo = this._demo;
    if (!demo.server) throw Error("Entity packet arrived before server info.");
    if (message.alternateBaselines?.length)
      throw Error("Alternate entity baselines require additional POV support.");
    const full = message.legacyIsDelta === false;
    if (full) banks.forEach((bank) => bank.clear());
    const bankIndex = message.baseline ?? 0;
    if (![0, 1].includes(bankIndex))
      throw Error("Unexpected entity baseline bank.");
    const readBank = banks[bankIndex],
      writeBank = banks[bankIndex === 0 ? 1 : 0];
    if (message.updateBaseline) diagnostics.baselinePackets++;
    const buffer = new BitBuffer(message.entityData);
    const extractor = new EntityMutationExtractor(buffer);
    const hasFilter = this._entityClassFilter !== null;
    const sizes =
      hasFilter && message.serializedEntities?.length
        ? new EntityPayloadSizeExtractor(
            message.serializedEntities,
            message.updatedEntries,
          ).retrieve()
        : null;
    const seen = new Set();
    let index = -1;
    for (let i = 0; i < message.updatedEntries; i++) {
      index += buffer.readUVarInt() + 1;
      const command = buffer.readBitsAsUInt(2);
      seen.add(index);
      if (
        command === EntityOperation.LEAVE.id ||
        command === EntityOperation.DELETE.id
      ) {
        const entity = demo.getEntity(index);
        if (entity) {
          if (command === EntityOperation.DELETE.id) demo.deleteEntity(index);
          else if (entity.active) entity.deactivate();
        }
        continue;
      }
      if (command === EntityOperation.CREATE.id) {
        const classId = buffer.readBitsAsUInt(demo.server.classIdSizeBits);
        const serial = buffer.readBitsAsUInt(17);
        buffer.readUVarInt32();
        const clazz = demo.getClassById(classId);
        if (!clazz) throw Error(`Unknown entity class ${classId}.`);
        const entity = new Entity(index, serial, clazz);
        const allowed = !hasFilter || this._entityClassFilter(clazz.name);
        const bits = sizes?.next().value;
        extractor.serializer = clazz.serializer;
        demo.registerEntity(entity);
        if (!allowed) {
          if (bits !== undefined) buffer.move(bits);
          else extractor.skip();
          continue;
        }
        const saved = !full ? readBank.get(index) : null;
        let baseline;
        if (saved?.classId === classId && classId > 0) {
          baseline = saved.batch;
          diagnostics.cachedBaselineCreates++;
        } else {
          const instance = demo.getClassBaseline(classId);
          if (!instance) throw Error(`Missing class baseline ${classId}.`);
          baseline = instance.getBatch(clazz.serializer);
        }
        const changes = extractor.all();
        entity.applyFromBatch(baseline);
        entity.applyFromBatch(changes);
        if (message.updateBaseline)
          writeBank.set(index, {
            classId,
            batch: EntityMutationBatch.concat([baseline, changes]),
          });
      } else if (command === EntityOperation.UPDATE.id) {
        if (message.hasPvsVisBits > 0 && buffer.readBitsAsUInt(2) & 1) continue;
        const entity = demo.getEntity(index);
        if (!entity) throw Error(`Update on missing entity ${index}.`);
        const allowed =
          !hasFilter || this._entityClassFilter(entity.class.name);
        const bits = sizes?.next().value;
        extractor.serializer = entity.class.serializer;
        if (allowed) {
          if (!entity.active) entity.activate();
          entity.applyFromExtractor(extractor);
        } else if (bits !== undefined) buffer.move(bits);
        else extractor.skip();
      } else throw Error(`Unexpected entity operation ${command}.`);
    }
    if (full)
      for (const entity of demo.getEntities())
        if (!seen.has(entity.index)) demo.deleteEntity(entity.index);
    return null;
  };
  return diagnostics;
}

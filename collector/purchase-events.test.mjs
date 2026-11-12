import test from "node:test";
import assert from "node:assert/strict";
import { MessagePacketType } from "deadem";
import proto from "./node_modules/deadem/src/providers/ProtoProvider.instance.js";
import { purchaseActors, purchaseMessageEvent } from "./local-reader.mjs";
import { PurchaseLedger } from "./purchases.mjs";

test("actual Deadem numeric purchase/sale enums feed the ledger; upgrade-only changes do not", () => {
  const type = proto.root.lookupType("CCitadelUserMsg_AbilitiesChanged");
  const actors = new Map([[6, { id: "player", name: "Player" }]]);
  const ledger = new PurchaseLedger([{ id: 21, cost: 800 }]);
  for (const change of [0, 1, 2]) {
    const data = type.decode(
      type
        .encode(type.create({ purchaserPlayerSlot: 6, abilityId: 21, change }))
        .finish(),
    );
    assert.equal(typeof data.change, "number");
    const event = purchaseMessageEvent(
      { type: MessagePacketType.CITADEL_USER_MESSAGE_ABILITY_CHANGED, data },
      change,
    );
    if (change === 1) assert.equal(event, null);
    else {
      assert.equal(event.sell, change === 2);
      ledger.record(event);
      ledger.flush(10 + change, actors);
    }
  }
  assert.equal(ledger.purchases.length, 1);
  assert.equal(ledger.purchases[0].playerId, "player");
  assert.equal(ledger.purchases[0].sold, true);
  assert.equal(ledger.purchases[0].status, "review");
});

test("client slots identify purchases even when spectators make lobby slots different", () => {
  const fields = {
    m_unLobbyPlayerSlot: 5,
    m_nHeroID: 7,
    m_iTeamNum: 2,
    m_steamID: 0,
    m_iszPlayerName: "Player",
    m_hHeroPawn: 100,
  };
  const controller = {
    index: 7,
    class: { name: "CCitadelPlayerController" },
    getField: (key) => fields[key],
  };
  const pawn = { getField: () => undefined };
  const actors = purchaseActors({
    getEntitiesByClassName: () => [controller],
    getEntityByHandle: () => pawn,
  });
  assert.equal(actors.has(4), false);
  assert.equal(actors.get(6).slot, 5);
  const ledger = new PurchaseLedger([{ id: 21, cost: 800 }]);
  ledger.record(
    purchaseMessageEvent({
      type: MessagePacketType.CITADEL_USER_MESSAGE_ABILITY_CHANGED,
      data: { purchaserPlayerSlot: 6, abilityId: 21, change: 0 },
    }),
  );
  ledger.flush(10, actors, true);
  assert.equal(ledger.purchases[0].playerId, "4000000005");
  assert.equal(ledger.purchases[0].status, "confirmed");
});

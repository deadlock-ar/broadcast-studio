import test from "node:test";
import assert from "node:assert/strict";
import { ultimateHit, ultimateEffects } from "./ultimates.mjs";

function fixture({
  sameTeam = false,
  removed = false,
  modifierId = 7,
  duplicate = false,
  bots = false,
} = {}) {
  const controller = (id, team, heroId) => ({
    class: { name: "CCitadelPlayerController" },
    index: id,
    getField: (key) =>
      ({
        m_steamID: bots ? "0" : String(76561197960265728n + BigInt(id)),
        m_unLobbyPlayerSlot: id,
        m_iTeamNum: team,
        m_nHeroID: heroId,
        m_iszPlayerName: `Player ${id}`,
      })[key],
  });
  const caster = controller(1, 2, 7),
    target = controller(2, sameTeam ? 2 : 3, 20);
  const pawns = new Map([
    [10, { class: { name: "CCitadelPlayerPawn" }, getField: () => 1 }],
    [20, { class: { name: "CCitadelPlayerPawn" }, getField: () => 2 }],
  ]);
  const value = {
    entryType: removed ? 2 : 1,
    abilitySubclass: 99,
    modifierSubclass: modifierId,
    parent: 20,
    caster: 10,
    serialNumber: 100,
    duration: 2.25,
  };
  return {
    getEntity: (i) => (i === 1 ? caster : i === 2 ? target : null),
    getEntityByHandle: (h) =>
      pawns.get(h) || (h === 1 ? caster : h === 2 ? target : null),
    stringTableContainer: {
      getByType: () => ({
        getEntries: () => (duplicate ? [{ value }, { value }] : [{ value }]),
      }),
    },
  };
}
const catalog = [{ id: 99, modifiers: [7] }];
test("local recording ultimates include bot identities consistently with the roster", () => {
  const d = fixture({ bots: true }),
    damage = {
      abilityId: 99,
      damage: 10,
      entindexAttacker: 1,
      entindexVictim: 2,
    };
  assert.equal(ultimateHit(d, damage, catalog), null);
  assert.equal(
    ultimateHit(d, damage, catalog, { includeBots: true }).targetId,
    "4000000002",
  );
  assert.equal(
    ultimateEffects(d, catalog, { includeBots: true })[0].targetId,
    "4000000002",
  );
});
test("ultimate damage is attributed to its enemy target; basic attacks and zero damage are ignored", () => {
  const message = {
    abilityId: 99,
    damage: 10,
    entindexAttacker: 1,
    entindexVictim: 2,
  };
  const hit = ultimateHit(fixture(), message, catalog);
  assert.equal(hit.targetId, "2");
  assert.equal(hit.casterId, "1");
  assert.equal(
    ultimateHit(fixture(), { ...message, abilityId: 10 }, catalog),
    null,
  );
  assert.equal(
    ultimateHit(fixture(), { ...message, damage: 0 }, catalog),
    null,
  );
  assert.equal(
    ultimateHit(fixture({ sameTeam: true }), message, catalog),
    null,
  );
  assert.ok(
    ultimateHit(
      fixture(),
      { ...message, damage: 0, damageAbsorbed: 10 },
      catalog,
    ),
  );
});
test("only validated enemy modifiers produce lasting indicators; removal and duplicate entries are handled", () => {
  assert.equal(
    ultimateEffects(fixture({ duplicate: true }), catalog).length,
    1,
  );
  assert.equal(ultimateEffects(fixture({ removed: true }), catalog).length, 0);
  assert.equal(ultimateEffects(fixture({ modifierId: 8 }), catalog).length, 0);
  assert.equal(ultimateEffects(fixture({ sameTeam: true }), catalog).length, 0);
});

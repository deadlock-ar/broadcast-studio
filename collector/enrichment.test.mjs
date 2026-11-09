import test from "node:test";
import assert from "node:assert/strict";
import { enrichFrame } from "./enrichment.mjs";

const entity = (handle, fields, active = true) => ({
  handle,
  active,
  getField: (key) => fields[key],
});
function fixture({
  controller = {},
  pawn = {},
  entities = [],
  signatures = [{ id: 11 }],
  items = [{ id: 21 }],
} = {}) {
  const owner = entity(1, {
    m_unLobbyPlayerSlot: 5,
    m_hHeroPawn: 100,
    ...controller,
  });
  const hero = entity(100, pawn);
  const all = [owner, hero, ...entities];
  const demo = {
    getEntities: () => all,
    getEntitiesByClassName: (name) =>
      name === "CCitadelPlayerController" ? [owner] : [],
    getEntityByHandle: (handle) => all.find((e) => e.handle === handle) || null,
  };
  const frame = { players: [{ id: "player", heroId: 7, slot: 5 }] };
  enrichFrame(demo, frame, { 7: signatures }, items);
  return frame.players[0];
}

test("controller inventory and ability upgrade state cover unobserved heroes with unresolved pawn entities", () => {
  const player = fixture({
    controller: {
      m_vecUpgrades: [21, 22],
      m_vecAbilityUpgradeState: [{ m_ItemID: 11, m_nUpgradeInfo: 983040 }],
    },
    pawn: { m_vecAbilities: [999, 998] },
  });
  assert.deepEqual(player.items, [21, 22]);
  assert.equal(player.abilities[0].level, 3);
  assert.equal(player.abilities[0].unlocked, true);
});

test("nested modern controller data takes precedence over stale owner entities", () => {
  const player = fixture({
    controller: {
      "m_PlayerDataGlobal.m_vecUpgrades": [21],
      "m_PlayerDataGlobal.m_vecAbilityUpgradeState": [
        { m_ItemID: 11, m_nUpgradeInfo: 458752 },
      ],
    },
    entities: [
      entity(201, {
        m_hOwnerEntity: 100,
        m_nSubclassID: 11,
        m_nUpgradeInfo: 0,
      }),
      entity(202, { m_hOwnerEntity: 100, m_nSubclassID: 22 }),
    ],
  });
  assert.deepEqual(player.items, [21]);
  assert.equal(player.abilities[0].level, 2);
});

test("missing, incomplete or sparse inventory remains unknown rather than empty", () => {
  assert.equal(fixture().items, null);
  assert.equal(fixture({ pawn: { m_vecAbilities: [999] } }).items, null);
  assert.equal(
    fixture({ controller: { m_vecUpgrades: [21, undefined] } }).items,
    null,
  );
  const sparse = [];
  sparse.length = 1;
  assert.equal(fixture({ controller: { m_vecUpgrades: sparse } }).items, null);
  assert.deepEqual(fixture({ controller: { m_vecUpgrades: [] } }).items, []);
  assert.deepEqual(fixture({ pawn: { m_vecAbilities: [] } }).items, []);
});

test("pawn fallback uses current vector membership, including inactive identities, and excludes stale owner-only items", () => {
  const player = fixture({
    pawn: { "m_CCitadelAbilityComponent.m_vecAbilities": [201, 202] },
    entities: [
      entity(201, { m_nSubclassID: 11, m_nUpgradeInfo: 983040 }, false),
      entity(202, { m_nSubclassID: 21 }, false),
      entity(203, { m_hOwnerEntity: 100, m_nSubclassID: 22 }),
    ],
    items: [{ id: 21 }, { id: 22 }],
  });
  assert.deepEqual(player.items, [21]);
  assert.equal(player.abilities[0].level, null);
  assert.equal(player.abilities[0].unlocked, null);
});

test("unknown packed tier values never imply an unlocked ability", () => {
  const player = fixture({
    controller: {
      m_vecAbilityUpgradeState: [{ m_ItemID: 11, m_nUpgradeInfo: 12345 }],
    },
  });
  assert.equal(player.abilities[0].level, null);
  assert.equal(player.abilities[0].unlocked, null);
  assert.equal(
    fixture({
      controller: {
        m_vecAbilityUpgradeState: [{ m_ItemID: 11, m_nUpgradeInfo: 0 }],
      },
    }).abilities[0].unlocked,
    false,
  );
});

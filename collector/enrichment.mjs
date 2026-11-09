// Recognized UpgradeBits encodings. Unknown values stay unknown; signature
// identity uses the asset catalogue, never a guessed entity slot number.
export function abilityTier(raw) {
  return (
    new Map([
      [0, null],
      [65536, 0],
      [196608, 1],
      [458752, 2],
      [983040, 3],
    ]).get(raw) ?? null
  );
}
export function enrichFrame(demo, frame, signatures, itemCatalog) {
  const items = new Set(itemCatalog.map((i) => i.id)),
    owned = new Map(),
    resolve = (handle) =>
      Number.isInteger(handle) ? demo.getEntityByHandle(handle) : null,
    globalField = (controller, field) =>
      controller?.getField(`m_PlayerDataGlobal.${field}`) ??
      controller?.getField(field);
  for (const entity of demo.getEntities()) {
    if (!entity.active) continue;
    const owner = entity.getField("m_hOwnerEntity"),
      id = entity.getField("m_nSubclassID");
    if (owner === undefined || id === undefined) continue;
    const list = owned.get(owner) || [];
    list.push({ id, raw: entity.getField("m_nUpgradeInfo") });
    owned.set(owner, list);
  }
  for (const player of frame.players) {
    const controller = demo
      .getEntitiesByClassName("CCitadelPlayerController")
      .find((c) => c.getField("m_unLobbyPlayerSlot") === player.slot);
    const pawn = resolve(controller?.getField("m_hHeroPawn")),
      handles =
        pawn?.getField("m_CCitadelAbilityComponent.m_vecAbilities") ??
        pawn?.getField("m_vecAbilities"),
      vector = Array.isArray(handles)
        ? Array.from(handles, (handle) => resolve(handle))
        : null,
      abilities = vector
        ? vector.flatMap((entity) =>
            entity
              ? [
                  {
                    id: entity.getField("m_nSubclassID"),
                    // Inactive entities retain identity but their tiers may be stale.
                    raw: entity.active
                      ? entity.getField("m_nUpgradeInfo")
                      : null,
                  },
                ]
              : [],
          )
        : pawn
          ? owned.get(pawn.handle) || []
          : [],
      upgrades = globalField(controller, "m_vecUpgrades"),
      upgradeStates = globalField(controller, "m_vecAbilityUpgradeState");
    player.objectiveDamage = controller?.getField("m_iObjectiveDamage") ?? null;
    // Controller inventory is replicated even when other heroes' ability
    // entities are outside the observer's PVS. The pawn vector is a fallback;
    // missing entities must never become a claim that an inventory is empty.
    player.items = Array.isArray(upgrades)
      ? Array.from(upgrades).every((id) => Number.isSafeInteger(id) && id >= 0)
        ? [...new Set(upgrades.filter((id) => id > 0))]
        : null
      : vector &&
          vector.every((entity) =>
            Number.isSafeInteger(entity?.getField("m_nSubclassID")),
          )
        ? [
            ...new Set(
              abilities.filter((a) => items.has(a.id)).map((a) => a.id),
            ),
          ]
        : null;
    player.abilities = (signatures[player.heroId] || []).map((a, index) => {
      const global = Array.isArray(upgradeStates)
        ? upgradeStates.find((v) => v?.m_ItemID === a?.id)
        : null;
      const state = global
        ? { raw: global.m_nUpgradeInfo }
        : abilities.find((v) => v.id === a?.id);
      const tier = abilityTier(state?.raw);
      return {
        slot: index + 1,
        id: a?.id || null,
        level: tier,
        unlocked: state?.raw === 0 ? false : tier !== null ? true : null,
        raw: state?.raw ?? null,
      };
    });
  }
  const rules = demo.getEntitiesByClassName("CCitadelGameRulesProxy")[0],
    id = rules?.getField("m_pGameRules.m_unMatchID");
  frame.matchId = Number.isSafeInteger(id) && id > 0 ? String(id) : null;
  return frame;
}
export function keyPlayers(players) {
  return [
    ["damage", "Top damage"],
    ["objectiveDamage", "Objectives"],
    ["healing", "Top healing"],
  ].flatMap(([key, label]) => {
    const eligible = players
      .filter((p) => Number.isFinite(p[key]) && p[key] > 0)
      .sort(
        (a, b) => b[key] - a[key] || String(a.id).localeCompare(String(b.id)),
      );
    return eligible.length
      ? [
          {
            playerId: eligible[0].id,
            label,
            metric: key,
            value: eligible[0][key],
          },
        ]
      : [];
  });
}
export function applySeriesWin(store, s, winner = s.result?.winner) {
  const numericId = s.result?.match?.matchId;
  if (
    !s.result ||
    ![0, 1].includes(winner) ||
    s.seriesAward ||
    ["replay", "rehearsal"].includes(s.mode)
  )
    return false;
  if (
    numericId &&
    [...(store.sessions?.values() || [])].some(
      (other) =>
        other.id !== s.id &&
        other.seriesAward &&
        other.result?.match?.matchId === numericId,
    )
  )
    return false;
  const before = store.workspace.config.teams.map((t) => t.score),
    after = [...before];
  after[winner] = Math.min(99, after[winner] + 1);
  s.seriesAward = {
    winner,
    before,
    after,
    matchId: numericId || null,
    at: Date.now(),
  };
  const revision = store.workspace.revision;
  store.workspace.config.teams[winner].score = after[winner];
  store.workspace.revision++;
  if (store.db) {
    store.db.exec("BEGIN IMMEDIATE");
    try {
      store.saveWorkspace();
      store.db
        .prepare("INSERT OR REPLACE INTO matches VALUES (?,?)")
        .run(s.id, JSON.stringify(s));
      store.db.exec("COMMIT");
    } catch (e) {
      store.db.exec("ROLLBACK");
      store.workspace.config.teams[winner].score = before[winner];
      store.workspace.revision = revision;
      delete s.seriesAward;
      throw e;
    }
  } else store.saveWorkspace();
  return true;
}

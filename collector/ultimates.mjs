import { StringTableType } from "deadem";
import { playerFor } from "./extract.mjs";

export function ultimateHit(demo, damage, catalog, options = {}) {
  const ability = catalog.find((a) => a.id === damage.abilityId);
  // Player-confirmed 2026-10-24 regression: a second-ability zombie reports
  // Graves' ultimate ID even while the ultimate is locked. Never show that hit.
  if (damage.abilityId === 4110547059) return null;
  if (
    !ability ||
    !(
      (damage.damage ?? 0) > 0 ||
      (damage.damageAbsorbed ?? 0) > 0 ||
      (damage.healthLost ?? 0) > 0
    )
  )
    return null;
  const caster = playerFor(
    demo,
    demo.getEntity(damage.entindexAttacker),
    options.includeBots,
  );
  const target = playerFor(
    demo,
    demo.getEntity(damage.entindexVictim),
    options.includeBots,
  );
  if (!caster || !target || caster.team === target.team) return null;
  return {
    key: `${caster.id}:${target.id}:${ability.id}`,
    casterId: caster.id,
    targetId: target.id,
    abilityId: ability.id,
    kind: "hit",
    durationMs: 1600,
  };
}
export function ultimateEffects(demo, catalog, options = {}) {
  const table = demo.stringTableContainer.getByType(
    StringTableType.ACTIVE_MODIFIERS,
  );
  const rows = [],
    seen = new Set();
  for (const entry of table?.getEntries() ?? []) {
    const v = entry.value;
    if (!v || v.entryType !== 1) continue;
    const ability = catalog.find(
      (a) =>
        a.id === v.abilitySubclass && a.modifiers.includes(v.modifierSubclass),
    );
    if (!ability) continue;
    const caster = playerFor(
      demo,
      demo.getEntityByHandle(v.caster),
      options.includeBots,
    );
    const target = playerFor(
      demo,
      demo.getEntityByHandle(v.parent),
      options.includeBots,
    );
    if (!caster || !target || caster.team === target.team) continue;
    const key = `${v.parent}:${v.serialNumber}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      key,
      casterId: caster.id,
      targetId: target.id,
      abilityId: ability.id,
      kind: "effect",
      duration: v.duration ?? null,
    });
  }
  return rows;
}

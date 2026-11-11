export const ULTIMATE_HIT_EXTRA_HOLD_MS = 1000;
export const ULTIMATE_HIT_FADE_MS = 300;

export function cleanUltimateBadges(value = {}) {
  const input = value && typeof value === "object" ? value : {};
  const iconSize = Number.isFinite(input.iconSize)
    ? Math.max(12, Math.min(48, Math.round(input.iconSize)))
    : 32;
  const byAbility = Object.fromEntries(
    Object.entries(input.byAbility || {})
      .filter(
        ([id, choice]) =>
          /^\d{1,10}$/.test(id) &&
          Number(id) > 0 &&
          Number(id) <= 4294967295 &&
          choice &&
          typeof choice === "object",
      )
      .slice(0, 128)
      .map(([id, choice]) => [
        id,
        { hit: choice.hit !== false, effect: choice.effect !== false },
      ])
      .filter(([, choice]) => !choice.hit || !choice.effect),
  );
  return {
    enabled: input.enabled !== false,
    iconSize,
    maxPerPlayer: [1, 2, 3, 4].includes(input.maxPerPlayer)
      ? input.maxPerPlayer
      : 4,
    byAbility,
  };
}

export function ultimateCapabilities(ability) {
  return {
    // Graves' second ability shares its ultimate ID in damage messages.
    hit: Boolean(
      ability &&
        Number.isInteger(ability.id) &&
        ability.id > 0 &&
        ability.id !== 4110547059,
    ),
    effect: Boolean(
      ability && Array.isArray(ability.modifiers) && ability.modifiers.length,
    ),
  };
}

export function ultimateBadgeAllowed(preferences, badge, catalog) {
  if (
    !badge ||
    !["hit", "effect"].includes(badge.kind) ||
    preferences?.enabled === false ||
    preferences?.byAbility?.[badge.abilityId]?.[badge.kind] === false
  )
    return false;
  if (catalog) {
    const ability = catalog.find((row) => row.id === badge.abilityId);
    return ultimateCapabilities(ability)[badge.kind];
  }
  return true;
}

export function filterUltimateBadges(badges, preferences, catalog) {
  const settings = cleanUltimateBadges(preferences),
    counts = new Map();
  return badges.filter((badge) => {
    if (!ultimateBadgeAllowed(settings, badge, catalog)) return false;
    const count = counts.get(badge.targetId) || 0;
    if (count >= settings.maxPerPlayer) return false;
    counts.set(badge.targetId, count + 1);
    return true;
  });
}

export function ultimateHitPresentation(hit, now) {
  if (!Number.isFinite(hit.at) || !Number.isFinite(now) || now < hit.at)
    return null;
  const duration =
    Number.isFinite(hit.durationMs) && hit.durationMs >= 0
      ? hit.durationMs
      : 1600;
  const hold = duration + ULTIMATE_HIT_EXTRA_HOLD_MS;
  const age = now - hit.at;
  if (age >= hold + ULTIMATE_HIT_FADE_MS) return null;
  return {
    ...hit,
    opacity: age <= hold ? 1 : 1 - (age - hold) / ULTIMATE_HIT_FADE_MS,
    phase: age <= hold ? "hold" : "fade",
  };
}

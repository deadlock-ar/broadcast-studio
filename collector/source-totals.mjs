const SOURCE_NAMES = {
  1: "Players",
  2: "Troopers",
  3: "Neutrals",
  4: "Objectives",
  5: "Treasure",
  6: "Assists",
  7: "Denies",
  8: "Team bonus",
  9: "Assassinate",
  10: "Trophy Collector",
  11: "Cultist Sacrifice",
  12: "Breakables",
  13: "Goose Egg",
};
const nonnegative = (value) =>
  Number.isFinite(value) && value >= 0 ? value : null;
// Source income is distinct from net worth. Optional missing amounts stay
// partial, and legacy aggregate counters are never added to gold_sources.
export function soulsBySource(sample) {
  if (!Array.isArray(sample?.gold_sources) || !sample.gold_sources.length)
    return null;
  return sample.gold_sources
    .map((row) => {
      const gold = nonnegative(row.gold),
        orbs = nonnegative(row.gold_orbs);
      return {
        source: row.source,
        label: SOURCE_NAMES[row.source] || `Source ${row.source}`,
        gold: gold === null || orbs === null ? null : gold + orbs,
        knownGold:
          gold === null && orbs === null ? null : (gold ?? 0) + (orbs ?? 0),
        complete: gold !== null && orbs !== null,
      };
    })
    .filter((row) => Number.isInteger(row.source));
}

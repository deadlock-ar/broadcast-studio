import { DRAFT_RULE } from "./draft.js";

export function cleanReportSettings(value = {}) {
  const ids = (values) =>
    [...new Set(Array.isArray(values) ? values : [])]
      .filter((v) => typeof v === "string" && v.length <= 250)
      .slice(0, 500);
  return {
    mode: ["heroes", "items", "mvp"].includes(value.mode)
      ? value.mode
      : "heroes",
    titles: Object.fromEntries(
      ["heroes", "items", "mvp"].map((k) => [
        k,
        String(value.titles?.[k] || "").slice(0, 43),
      ]),
    ),
    tournament: String(value.tournament || "").slice(0, 120),
    selectedDrafts: ids(value.selectedDrafts),
    selectedGames: ids(value.selectedGames),
    comparisonGames: ids(value.comparisonGames),
    mvpPlayerId: /^\d{1,10}$/.test(value.mvpPlayerId || "")
      ? value.mvpPlayerId
      : "",
    mvpSource: value.mvpSource === "manual" ? "manual" : "recorded",
    manualMvp: {
      name: String(value.manualMvp?.name || "").slice(0, 48),
      heroId: Number.isSafeInteger(value.manualMvp?.heroId)
        ? value.manualMvp.heroId
        : null,
      ...Object.fromEntries(
        ["kills", "deaths", "assists", "damage", "souls"].map((key) => [
          key,
          Number.isSafeInteger(value.manualMvp?.[key]) &&
          value.manualMvp[key] >= 0 &&
          value.manualMvp[key] <= 9999999999
            ? value.manualMvp[key]
            : null,
        ]),
      ),
    },
    includeZero: value.includeZero !== false,
    includePartial: value.includePartial === true,
  };
}

export function draftSelections(snapshot) {
  const counts = { "1:ban": 0, "2:ban": 0, "1:pick": 0, "2:pick": 0 };
  const openingPicks = {};
  for (const team of [1, 2]) {
    const i = (snapshot?.steps || []).findIndex(
      (s) => s.teamNumber === team && s.selectionType === "pick",
    );
    let end = i;
    while (
      end >= 0 &&
      snapshot?.steps[end]?.selectionType === "pick" &&
      snapshot.steps[end].teamNumber === team
    )
      end++;
    openingPicks[team] = i < 0 ? 0 : end - i;
  }
  const firstPick = (snapshot?.steps || []).findIndex(
    (s) => s.selectionType === "pick",
  );
  // Keep received order: selectionNumber can be per side on older sources.
  return (snapshot?.steps || []).map((step, index) => {
    const ordinal = ++counts[`${step.teamNumber}:${step.selectionType}`];
    return {
      ...step,
      order: index + 1,
      firstRound:
        step.selectionType === "ban"
          ? index < firstPick
          : ordinal <= openingPicks[step.teamNumber],
    };
  });
}
export function draftPriority(drafts, heroes = []) {
  const rows = new Map(
    heroes.map((h) => [
      h.id,
      {
        id: h.id,
        name: h.name,
        image: h.image,
        total: 0,
        firstBan: 0,
        ban: 0,
        firstPick: 0,
        pick: 0,
      },
    ]),
  );
  for (const draft of drafts)
    for (const step of draft.selections || draftSelections(draft.snapshot)) {
      if (!step.heroId) continue;
      const row = rows.get(step.heroId) || {
        id: step.heroId,
        name: `Hero ${step.heroId}`,
        total: 0,
        firstBan: 0,
        ban: 0,
        firstPick: 0,
        pick: 0,
      };
      const key =
        step.selectionType === "ban"
          ? step.firstRound
            ? "firstBan"
            : "ban"
          : step.firstRound
            ? "firstPick"
            : "pick";
      row[key]++;
      row.total++;
      rows.set(row.id, row);
    }
  return [...rows.values()].sort(
    (a, b) =>
      b.total - a.total ||
      b.firstBan - a.firstBan ||
      a.name.localeCompare(b.name),
  );
}
export function itemPriority(games, items = [], baseline = []) {
  const names = new Map(items.map((i) => [i.id, i]));
  const count = (list) => {
    const counts = new Map();
    for (const game of list)
      for (const p of game.purchases || [])
        if (p.status === "confirmed")
          counts.set(p.itemId, (counts.get(p.itemId) || 0) + 1);
    return [...counts]
      .map(([id, total]) => ({
        id,
        total,
        average: total / (list.length || 1),
        ...names.get(id),
      }))
      .sort(
        (a, b) =>
          b.total - a.total ||
          String(a.name || a.id).localeCompare(String(b.name || b.id)),
      );
  };
  const previous = count(baseline);
  return count(games).map((row, i) => {
    const index = previous.findIndex((p) => p.id === row.id);
    return {
      ...row,
      rank: i + 1,
      rankChange: index < 0 ? null : index - i,
      averageChange: baseline.length
        ? row.average - (previous[index]?.average || 0)
        : null,
    };
  });
}
export { DRAFT_RULE };

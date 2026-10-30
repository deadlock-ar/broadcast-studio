import { draftPriority, itemPriority } from "../src/analytics.js";
import { inTournament } from "./tournaments.mjs";
export function reportOutput(store, channel, heroes, items) {
  const settings = store.workspace.reports || {},
    mode = {
      "hero-priority": "heroes",
      "top-items": "items",
      "series-mvp": "mvp",
    }[channel];
  const drafts = store.archive
    .list()
    .filter(
      (d) =>
        inTournament(d, store) &&
        !d.excluded &&
        (settings.selectedDrafts || []).includes(d.id),
    );
  const all = [...store.sessions.values()]
    .filter(
      (s) =>
        inTournament(s, store) && !["replay", "rehearsal"].includes(s.mode),
    )
    .map((s) => ({
      id: s.id,
      tournament: s.tournament || "",
      ended: Boolean(s.result),
      players: s.result?.match.players || [],
      purchases: [],
      ...s.items,
    }));
  const games = all.filter(
    (g) =>
      (settings.selectedGames || []).includes(g.id) &&
      (mode === "mvp"
        ? g.ended
        : settings.includePartial || (g.ended && g.fromStart)),
  );
  const baseline = all.filter((g) =>
    (settings.comparisonGames || []).includes(g.id),
  );
  const title = settings.titles?.[mode] || "";
  if (mode === "mvp" && settings.mvpSource === "manual") {
    const player = settings.manualMvp;
    return {
      mode,
      title,
      player,
      visible: Boolean(
        player?.name?.trim() && heroes.some((h) => h.id === player.heroId),
      ),
    };
  }
  if (mode === "heroes")
    return {
      mode,
      title,
      games: drafts.length,
      rows: draftPriority(drafts, heroes).filter(
        (r) => settings.includeZero !== false || r.total,
      ),
      visible: drafts.length > 0,
    };
  if (mode === "items")
    return {
      mode,
      title,
      games: games.length,
      baselineGames: baseline.length,
      rows: itemPriority(games, items, baseline),
      visible:
        games.length > 0 &&
        !games.some((g) =>
          g.purchases.some((p) => ["pending", "review"].includes(p.status)),
        ),
    };
  const appearances = games.flatMap((g) =>
    g.players.filter((p) => p.id === settings.mvpPlayerId),
  );
  const first = appearances[0];
  const player = first
    ? {
        id: first.id,
        name: first.name,
        heroId: first.heroId,
        ...Object.fromEntries(
          ["damage", "souls", "kills", "deaths", "assists"].map((k) => [
            k,
            appearances.every((p) => Number.isFinite(p[k]))
              ? appearances.reduce((sum, p) => sum + p[k], 0)
              : null,
          ]),
        ),
      }
    : null;
  return { mode, title, player, games: games.length, visible: Boolean(player) };
}

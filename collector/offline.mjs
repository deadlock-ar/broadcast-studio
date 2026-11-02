import { normalizeMetadata, playersAt, nonnegative } from "../src/stats.js";
import { emptySession, completeRoster, matchId } from "./model.mjs";
import { metricFrame } from "./telemetry.mjs";

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
// Income is distinct from net worth. Never add the legacy fields to gold_sources.
export function soulsBySource(sample) {
  if (!Array.isArray(sample?.gold_sources) || !sample.gold_sources.length)
    return null;
  return sample.gold_sources
    .map((s) => {
      const gold = nonnegative(s.gold),
        orbs = nonnegative(s.gold_orbs);
      return {
        source: s.source,
        label: SOURCE_NAMES[s.source] || `Source ${s.source}`,
        gold: gold === null || orbs === null ? null : gold + orbs,
        knownGold:
          gold === null && orbs === null ? null : (gold ?? 0) + (orbs ?? 0),
        complete: gold !== null && orbs !== null,
      };
    })
    .filter((s) => Number.isInteger(s.source));
}
export function importedMatch(raw, expectedId, itemCatalog, now = Date.now()) {
  const normalized = normalizeMetadata(raw, expectedId),
    id = normalized.id;
  if (!(normalized.duration > 0) || ![0, 1].includes(normalized.winningTeam))
    throw Error("This match has no finished result yet. No game was imported.");
  const originals = new Map(
    raw.match_info.players.map((p) => [
      String(p.account_id || p.player_slot),
      p,
    ]),
  );
  const rowsAt = (time, final = false) =>
    playersAt(normalized, time).map((p) => {
      const original = originals.get(p.id);
      const sample = (original.stats || [])
        .filter(
          (s) => nonnegative(s.time_stamp_s) !== null && s.time_stamp_s <= time,
        )
        .sort((a, b) => a.time_stamp_s - b.time_stamp_s)
        .at(-1);
      return {
        id: p.id,
        slot: p.slot,
        heroId: p.heroId,
        team: p.team,
        name: p.name || `Player ${p.slot || p.id}`,
        damage: p.damage,
        healing: p.healing,
        souls: p.souls,
        kills: p.kills,
        deaths: p.deaths,
        assists: p.assists,
        buffs: p.buffs,
        objectiveDamage: nonnegative(sample?.boss_damage),
        soulsBySource: final ? soulsBySource(sample) : null,
        // Metadata item history alone does not prove final held inventory or tiers.
        items: null,
        abilities: null,
        mvpRank: final ? nonnegative(original.mvp_rank) : null,
        sampleTime: sample?.time_stamp_s ?? null,
      };
    });
  const players = rowsAt(normalized.duration, true);
  if (!completeRoster(players))
    throw Error("A complete twelve-player match is required for import.");
  const times = [
    ...new Set(normalized.players.flatMap((p) => p.samples.map((s) => s.time))),
  ].sort((a, b) => a - b);
  const points = times.map((time) => {
    const rows = rowsAt(time),
      point = metricFrame({ duration: time, players: rows });
    // Do not fill another player's missing sample with an older total.
    if (rows.some((p) => p.sampleTime !== time)) point.teams = null;
    return point;
  });
  const intervals = times
    .slice(1)
    .map((t, i) => t - times[i])
    .filter((n) => n > 0)
    .sort((a, b) => a - b);
  const telemetry = {
    version: 1,
    interval: intervals[Math.floor(intervals.length / 2)] || 60,
    source: "metadata",
    points: points.slice(-1441),
  };
  const s = emptySession(id, "offline");
  s.provider = "deadlock-api";
  s.status = "finished";
  s.message = "Imported finished match · review before publishing";
  s.updatedAt = now;
  s.label = `Off-stream · Match ${id}`;
  s.match = {
    id,
    matchId: id,
    mode: "snapshot",
    provider: "deadlock-api",
    duration: normalized.duration,
    players,
    complete: true,
    currentComplete: true,
    telemetry,
    metricFrame: metricFrame({ duration: normalized.duration, players }),
  };
  s.result = {
    match: structuredClone(s.match),
    winner: normalized.winningTeam,
    endObserved: true,
    verification: "metadata",
    captureMode: "offline",
    capturedAt: now,
    mvpId: players.find((p) => p.mvpRank === 1)?.id || null,
  };
  const knownItems = new Set(itemCatalog.map((i) => i.id));
  const purchases = players.flatMap((p) =>
    (originals.get(p.id).items || [])
      .filter(
        (item) =>
          knownItems.has(item.item_id) &&
          nonnegative(item.game_time_s) !== null,
      )
      .map((item, index) => ({
        id: `metadata:${id}:${p.id}:${index}`,
        playerId: p.id,
        playerName: p.name,
        itemId: item.item_id,
        gameTime: item.game_time_s,
        soldTime: nonnegative(item.sold_time_s) || null,
        status: "review",
        evidence:
          "Metadata item entry; confirm purchase and refund outcome before reports",
        source: "metadata",
        flags: item.flags ?? null,
        upgradeId: item.upgrade_id ?? null,
      })),
  );
  const hasItems = raw.match_info.players.every(
    (p) => Array.isArray(p.items) && p.items.length > 0,
  );
  s.items = {
    revision: 1,
    purchases,
    fromStart: hasItems,
    reviewCount: purchases.length,
    coverage:
      "Metadata item history; final holdings and refund outcomes are not inferred",
  };
  s.offline = {
    importedAt: now,
    itemCoverage: hasItems
      ? "metadata-review-required"
      : "unavailable-or-partial",
    draftOrderKnown: false,
    banTeamsKnown: false,
    unassignedBans:
      Array.isArray(raw.banned_hero_ids) && raw.banned_hero_ids.length
        ? [
            ...new Set(
              raw.banned_hero_ids.filter((n) => Number.isInteger(n) && n > 0),
            ),
          ]
        : null,
    pregameHeroes: Object.fromEntries(
      players
        .filter(
          (p) =>
            Number.isInteger(raw.pregame_hero_ids?.[p.id]) &&
            raw.pregame_hero_ids[p.id] > 0,
        )
        .map((p) => [p.id, raw.pregame_hero_ids[p.id]]),
    ),
  };
  return s;
}
export function offlineDraft(s, workspace) {
  const picks = s.match.players.map((p, i) => ({
    id: `metadata-pick:${p.id}`,
    teamNumber: p.team + 1,
    selectionType: "pick",
    heroId: s.offline.pregameHeroes[p.id] || p.heroId,
    selectionNumber: i + 1,
    order: null,
    orderKnown: false,
    firstRound: null,
  }));
  const selections = [
    ...picks,
    ...(s.offline.unassignedBans || []).map((heroId) => ({
      heroId,
      teamNumber: null,
      selectionType: "ban",
      order: null,
      orderKnown: false,
      firstRound: null,
    })),
  ];
  return {
    id: `metadata:${workspace.activeTournamentId}:${s.id}`,
    source: "metadata",
    matchId: s.id,
    rule: "metadata-final-roster",
    label: `Off-stream · Match ${s.id} · order unavailable`,
    tournamentId: workspace.activeTournamentId,
    tournament: workspace.config.event,
    config: structuredClone(workspace.config),
    completed: true,
    orderKnown: false,
    bansKnown: s.offline.unassignedBans !== null,
    banTeamsKnown: false,
    snapshot: {
      status: "COMPLETED",
      steps: picks,
      teams: [],
      currentStepIndex: picks.length,
    },
    selections,
    createdAt: s.updatedAt,
    updatedAt: s.updatedAt,
  };
}

export class OfflineImporter {
  constructor(
    store,
    items,
    load = async (id, allowSteam) => {
      const url = `https://api.deadlock-api.com/v1/matches/${id}/metadata?is_custom=true&disable_steam=${!allowSteam}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!response.ok)
        throw Error(
          `Finished metadata unavailable (HTTP ${response.status}). Try cached data later or explicitly allow Steam lookup.`,
        );
      return response.json();
    },
  ) {
    Object.assign(this, { store, items, load });
    this.pending = new Set();
  }
  async import(value) {
    const id = matchId(value.id),
      tournamentId = this.store.workspace.activeTournamentId;
    const assertAvailable = () => {
      if (this.store.workspace.activeTournamentId !== tournamentId)
        throw Error(
          "Tournament changed during import. Try again in the intended tournament.",
        );
      if (this.store.tournaments.isDeleted(id))
        throw Error(
          "Restore this deleted game from Trash before importing it.",
        );
      const sameMatch = (s) =>
        [
          s?.id,
          s?.match?.matchId,
          s?.result?.match?.matchId,
          s?.published?.match?.matchId,
        ].some((n) => String(n) === id);
      if ([...this.store.sessions.values()].some(sameMatch))
        throw Error(
          "This match is already saved. Choose it from Saved games; existing results were retained.",
        );
      if (
        this.store.tournaments
          .listTrash()
          .some((r) =>
            r.kind === "game"
              ? sameMatch(r.record)
              : (r.games || []).some(sameMatch),
          )
      )
        throw Error(
          "This match is in Trash. Restore its saved recording instead of importing a duplicate.",
        );
    };
    assertAvailable();
    if (this.pending.has(id))
      throw Error("This match is already being imported.");
    this.pending.add(id);
    try {
      const raw = await this.load(id, value.allowSteam === true);
      const s = importedMatch(raw, id, this.items);
      assertAvailable();
      s.tournamentId = tournamentId;
      s.tournament = this.store.workspace.config.event;
      const linked =
        value.draftId &&
        this.store.archive
          .list()
          .find(
            (d) => d.id === value.draftId && d.tournamentId === tournamentId,
          );
      if (value.draftId && !linked)
        throw Error("Choose a saved draft from the selected tournament.");
      const draft = linked || offlineDraft(s, this.store.workspace);
      s.draftArchiveId = draft.id;
      this.store.db.exec("BEGIN IMMEDIATE");
      try {
        this.store.db
          .prepare("INSERT INTO matches VALUES (?,?)")
          .run(id, JSON.stringify(s));
        if (!linked)
          this.store.db
            .prepare("INSERT OR REPLACE INTO drafts VALUES (?,?)")
            .run(draft.id, JSON.stringify(draft));
        this.store.db.exec("COMMIT");
      } catch (e) {
        this.store.db.exec("ROLLBACK");
        throw e;
      }
      this.store.sessions.set(id, s);
      return {
        id,
        draftId: draft.id,
        purchases: s.items.purchases.length,
        bansKnown: linked
          ? linked.selections?.some((p) => p.selectionType === "ban") === true
          : s.offline.unassignedBans !== null,
        players: s.match.players.length,
      };
    } finally {
      this.pending.delete(id);
    }
  }
}

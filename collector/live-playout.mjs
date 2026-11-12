import { cleanSettings } from "./model.mjs";

export const BUFFERED_LIVE_CHANNELS = [
  "deadem",
  "ultimates",
  "momentum",
  "live-events",
];

export function cleanLiveDelay(value) {
  return Number.isFinite(value)
    ? Math.max(0, Math.min(120000, Math.round(value)))
    : null;
}

// Existing tournaments inherit their selected game's delay until the operator
// saves the shared setting. Once saved, it survives selecting or starting games.
export function liveDelayMs(workspace, session) {
  return (
    cleanLiveDelay(workspace?.deadem?.delayMs) ??
    cleanLiveDelay(session?.settings?.delayMs) ??
    0
  );
}

export function cleanPersistentHud(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { hud, hudOrder, ultimateBadges, names } = cleanSettings(value);
  return { hud, hudOrder, ultimateBadges, names };
}

export function livePresentationSettings(workspace, session) {
  return {
    ...cleanSettings(session?.settings || {}),
    ...cleanPersistentHud(workspace?.deadem?.hudSettings),
    delayMs: liveDelayMs(workspace, session),
  };
}

// Recover the most recent saved calibration when legacy games reset to defaults.
// Only presentation preferences move: fight baselines and match data stay put.
export function rememberLiveSettings(store) {
  const defaults = cleanSettings({});
  for (const record of store.tournaments.records.values()) {
    const state = record.state;
    const deadem = (state.deadem ||= {});
    const games = [...store.sessions.values()]
      .filter((s) => s.tournamentId === record.id)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const selected = games.find((s) => s.id === deadem.id) || games[0];
    if (!cleanPersistentHud(deadem.hudSettings)) {
      const custom = (s) =>
        s &&
        JSON.stringify(cleanSettings(s.settings || {}).hud) !==
          JSON.stringify(defaults.hud);
      const calibration = custom(selected)
        ? selected
        : games.find(custom) || selected;
      deadem.hudSettings = cleanPersistentHud({
        ...selected?.settings,
        hud: calibration?.settings?.hud,
        hudOrder: calibration?.settings?.hudOrder,
      });
    }
    if (cleanLiveDelay(deadem.delayMs) === null) {
      deadem.delayMs =
        cleanLiveDelay(
          selected?.settings?.delayMs ||
            games.find((s) => s.settings?.delayMs > 0)?.settings.delayMs ||
            0,
        ) ?? 0;
    }
    store.tournaments.put(record);
    if (record.id === store.workspace.activeTournamentId) {
      store.workspace.deadem.hudSettings = deadem.hudSettings;
      store.workspace.deadem.delayMs = deadem.delayMs;
    }
  }
  store.saveWorkspace();
}

export function apiPlayoutClock(workspace, session, now) {
  const api = workspace.apiStats;
  return {
    id: `api:${api.source?.mode || "finished"}:${api.source?.id || api.result?.match?.id || "idle"}`,
    settings: {
      delayMs:
        api.source?.mode === "live" ? liveDelayMs(workspace, session) : 0,
    },
    updatedAt: api.result?.updated,
    sourceTiming: { basis: "receipt", sentAt: now },
  };
}

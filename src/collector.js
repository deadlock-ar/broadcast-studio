import { tournamentHeaders } from "./tournament-context.js";
import {
  filterUltimateBadges,
  ultimateBadgeAllowed,
  ultimateHitPresentation,
} from "../collector/ultimate-settings.mjs";
export { liveRoster } from "./roster-order.js";
export const COLLECTOR_ORIGIN = "http://127.0.0.1:8766";
export function enqueueCollectorState(
  queue,
  value,
  now,
  delay,
  intervalMs = 100,
  clock = {},
) {
  const session = value?.session || value;
  const timing = session?.sourceTiming;
  const sourceTimed =
    timing?.basis === "recording-timeline" &&
    Number.isFinite(timing.sourceAt) &&
    Number.isFinite(timing.sentAt);
  const identity = `${session?.id || ""}:${sourceTimed ? timing.timelineId : "receipt"}`;
  if (clock.identity !== identity || clock.delay !== delay) {
    if (clock.identity !== undefined) queue = [];
    Object.assign(clock, { identity, delay, offset: null, lastSourceAt: null });
  }
  if (
    sourceTimed &&
    clock.lastSourceAt !== null &&
    timing.sourceAt < clock.lastSourceAt
  )
    return queue;
  if (clock.offset === null && Number.isFinite(timing?.sentAt))
    clock.offset = now - timing.sentAt;
  if (sourceTimed) clock.lastSourceAt = timing.sourceAt;
  const due = sourceTimed
    ? timing.sourceAt + delay + clock.offset
    : now + delay;
  const playout = {
    mode: sourceTimed ? "recording-timeline" : "receipt",
    targetMs: delay,
    clockOffsetMs: clock.offset || 0,
    scheduledAt: due,
    lateByMs: Math.max(0, now - due),
  };
  const projected = { ...session, playout };
  const next = {
    at: Math.max(now, due),
    value: value?.session ? { ...value, session: projected } : projected,
  };
  const last = queue.at(-1);
  const interval =
    Number.isFinite(intervalMs) && intervalMs > 0
      ? Math.max(1, intervalMs)
      : 100;
  // Ordinary outputs retain 10 Hz; slower graph outputs need fewer snapshots.
  if (last && Math.floor(last.at / interval) === Math.floor(next.at / interval))
    queue[queue.length - 1] = next;
  else queue.push(next);
  return queue.slice(-(Math.ceil(120000 / interval) + 100));
}
// The target follows observed recording delivery, not a measured absolute
// game-to-screen timestamp. Late source packets cannot meet an earlier target.
export function collectorRenderNow(session, now, delayed = true) {
  return (
    now -
    (session?.playout?.clockOffsetMs || 0) -
    (delayed
      ? (session?.playout?.targetMs ?? session?.settings?.delayMs ?? 0)
      : 0)
  );
}
export const collectorFreshAt = (session) =>
  session?.sourceTiming?.basis === "recording-timeline" &&
  Number.isFinite(session.sourceTiming.sourceAt)
    ? session.sourceTiming.sourceAt
    : session?.updatedAt;
export function collectorEndpoint(path, id) {
  const url = new URL(
    `/api/collector/${path}`,
    globalThis.__DLAR_CLOUD__ ? window.location.origin : COLLECTOR_ORIGIN,
  );
  if (id) url.searchParams.set("match", id);
  return url.href;
}
export async function collectorRequest(path, id, value, signal) {
  const response = await fetch(collectorEndpoint(path, id), {
    signal,
    ...(value === undefined
      ? {}
      : {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...tournamentHeaders(),
          },
          body: JSON.stringify(value),
        }),
  });
  const result = await response.json();
  if (!response.ok)
    throw Error(result.error || `Collector HTTP ${response.status}`);
  return result;
}
export function collectorOverlayUrl(
  view,
  id,
  metric = "damage",
  content = "players",
) {
  if (globalThis.__DLAR_CLOUD__)
    return new URL(
      {
        "collector-panel": "/obs/deadem",
        "ultimate-hud": "/obs/ultimates",
        scoreboard: "/obs/scoreboard",
      }[view],
      window.location.origin,
    ).href;
  const url = new URL(COLLECTOR_ORIGIN);
  url.searchParams.set("view", view);
  url.searchParams.set("match", id);
  if (view === "collector-panel") url.searchParams.set("metric", metric);
  if (view === "collector-panel" && content === "souls-graph")
    url.searchParams.set("content", content);
  return url.href;
}
export function visibleUltimateBadges(session, now) {
  if (
    !session ||
    session.status !== "live" ||
    !collectorFreshAt(session) ||
    now - collectorFreshAt(session) > 10000
  )
    return [];
  const active = [
    ...(session.effects || []),
    ...(session.recentHits || [])
      .map((hit) => ultimateHitPresentation(hit, now))
      .filter(Boolean),
  ];
  const unique = new Map();
  for (const item of active) {
    if (!ultimateBadgeAllowed(session.settings?.ultimateBadges, item)) continue;
    const key = `${item.targetId}:${item.abilityId}`;
    const previous = unique.get(key);
    if (
      !previous ||
      item.kind === "effect" ||
      (previous.kind === "hit" && item.kind === "hit" && item.at > previous.at)
    )
      unique.set(key, item);
  }
  return filterUltimateBadges(
    [...unique.values()],
    session.settings?.ultimateBadges,
  );
}

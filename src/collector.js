import { tournamentHeaders } from "./tournament-context.js";
export { liveRoster } from "./roster-order.js";
export const COLLECTOR_ORIGIN = "http://127.0.0.1:8766";
export function enqueueCollectorState(
  queue,
  value,
  now,
  delay,
  intervalMs = 100,
) {
  const next = { at: now + delay, value };
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
export function collectorOverlayUrl(view, id, metric = "damage") {
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
  return url.href;
}
export function visibleUltimateBadges(session, now) {
  if (
    !session ||
    session.status !== "live" ||
    !session.updatedAt ||
    now - session.updatedAt > 10000
  )
    return [];
  const active = [
    ...(session.effects || []),
    ...(session.recentHits || []).filter(
      (h) => now >= h.at && now - h.at < h.durationMs,
    ),
  ];
  const unique = new Map();
  for (const item of active) {
    const key = `${item.targetId}:${item.abilityId}`;
    if (!unique.has(key) || item.kind === "effect") unique.set(key, item);
  }
  return [...unique.values()];
}

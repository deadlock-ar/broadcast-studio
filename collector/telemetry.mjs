// Source-clock samples only. Missing observations never become zero or a
// reconstructed history, including after reconnecting halfway through a game.
export const TELEMETRY_INTERVAL = 5;
export const TELEMETRY_LIMIT = 1441;
export const METRIC_FIELDS = [
  "souls",
  "damage",
  "objectiveDamage",
  "healing",
  "kills",
  "deaths",
  "assists",
  "buffs",
];
const known = (value) => Number.isFinite(value) && value >= 0;
export function metricFrame(frame) {
  const players = (frame?.players || []).slice(0, 12).map((p) => ({
    id: String(p.id),
    team: p.team,
    ...Object.fromEntries(
      METRIC_FIELDS.map((key) => [key, known(p[key]) ? p[key] : null]),
    ),
  }));
  const complete =
    players.length === 12 &&
    new Set(players.map((p) => p.id)).size === 12 &&
    [0, 1].every((team) => players.filter((p) => p.team === team).length === 6);
  return {
    time: known(frame?.duration) ? frame.duration : null,
    players,
    teams: complete
      ? [0, 1].map((team) => {
          const rows = players.filter((p) => p.team === team);
          return Object.fromEntries(
            METRIC_FIELDS.map((key) => [
              key,
              rows.every((p) => known(p[key]))
                ? rows.reduce((sum, p) => sum + p[key], 0)
                : null,
            ]),
          );
        })
      : null,
  };
}
export function recordTelemetry(previous, point, force = false) {
  const history =
    previous?.version === 1 && Array.isArray(previous.points)
      ? previous
      : { version: 1, interval: TELEMETRY_INTERVAL, points: [] };
  if (!known(point?.time)) return history;
  const last = history.points.at(-1);
  // A relay can replay older fragments on reconnect. Never append backwards.
  if (last && point.time < last.time) return history;
  const compact = {
    time: point.time,
    teams: point.teams?.map((team) => ({ souls: team.souls })) || null,
    players: point.players.map((p) => ({
      id: p.id,
      team: p.team,
      souls: p.souls,
    })),
  };
  if (last && point.time === last.time) {
    return force
      ? { ...history, points: [...history.points.slice(0, -1), compact] }
      : history;
  }
  if (last && !force && point.time - last.time < TELEMETRY_INTERVAL)
    return history;
  const points = [...history.points, compact]
    .slice(-TELEMETRY_LIMIT)
    .map((sample) =>
      sample.time < point.time - 65 && sample.players
        ? { time: sample.time, teams: sample.teams }
        : sample,
    );
  return { ...history, points };
}
export function cleanMetricsBaseline(value) {
  if (
    !value ||
    !known(value.time) ||
    value.time > 86400 ||
    !Array.isArray(value.players)
  )
    return null;
  const sample = metricFrame({ duration: value.time, players: value.players });
  if (!sample.teams || sample.players.some((p) => !/^\d{1,10}$/.test(p.id)))
    return null;
  return { time: sample.time, players: sample.players };
}
export function captureBaseline(match) {
  if (match?.metricFrame?.time < (match?.telemetry?.points?.at(-1)?.time ?? 0))
    return null;
  return cleanMetricsBaseline(match?.metricFrame);
}
export function currentMetricRows(match) {
  // Identity can survive a reconnect, but current numbers must come from the
  // latest raw observation rather than the merged retained player records.
  return new Map((match?.metricFrame?.players || []).map((p) => [p.id, p]));
}
export function changesSince(match, baseline) {
  const current = match?.metricFrame,
    clean = cleanMetricsBaseline(baseline);
  if (current?.time < (match?.telemetry?.points?.at(-1)?.time ?? 0))
    return null;
  if (
    !current?.teams ||
    !known(current.time) ||
    !clean ||
    current.time < clean.time
  )
    return null;
  const before = new Map(clean.players.map((p) => [p.id, p]));
  if (current.players.some((p) => before.get(p.id)?.team !== p.team))
    return null;
  return new Map(
    current.players.map((p) => {
      const old = before.get(p.id);
      return [
        p.id,
        Object.fromEntries(
          METRIC_FIELDS.map((key) => [
            key,
            known(p[key]) &&
            known(old[key]) &&
            (key === "souls" || p[key] >= old[key])
              ? p[key] - old[key]
              : null,
          ]),
        ),
      ];
    }),
  );
}
export function netWorthRates(match, seconds = 60) {
  const current = match?.metricFrame;
  if (!current?.teams || !known(current.time)) return new Map();
  const points = match.telemetry?.points || [];
  if (current.time < (points.at(-1)?.time ?? 0)) return new Map();
  const target = Math.max(0, current.time - seconds);
  // Prefer a full observed minute; while warming up use only measured time.
  const before = points.find(
    (p) => p.time >= target && current.time - p.time >= 5 && p.teams,
  );
  if (!before) return new Map();
  // A missing roster or source gap makes the whole window unknown.
  const window = [
    ...points.filter((p) => p.time >= before.time && p.time <= current.time),
    current,
  ];
  if (
    window.some(
      (p, i) =>
        !p.teams?.every((t) => known(t.souls)) ||
        (i > 0 && p.time - window[i - 1].time > 15),
    )
  )
    return new Map();
  const old = new Map((before.players || []).map((p) => [p.id, p]));
  const elapsed = current.time - before.time;
  return new Map(
    current.players.map((p) => {
      const previous = old.get(p.id);
      return [
        p.id,
        previous?.team === p.team && known(previous.souls) && known(p.souls)
          ? {
              value: ((p.souls - previous.souls) * 60) / elapsed,
              seconds: elapsed,
            }
          : null,
      ];
    }),
  );
}
export function soulsSegments(telemetry) {
  const segments = [];
  let segment = [],
    last = null;
  const maxGap = Math.max(
    15,
    (Number(telemetry?.interval) || TELEMETRY_INTERVAL) * 3,
  );
  for (const point of telemetry?.points || []) {
    const valid =
      known(point.time) &&
      point.teams?.length === 2 &&
      point.teams.every((t) => known(t.souls));
    if (!valid || (last !== null && point.time - last > maxGap)) {
      if (segment.length) segments.push(segment);
      segment = [];
    }
    if (valid)
      segment.push({
        time: point.time,
        value: point.teams[0].souls - point.teams[1].souls,
      });
    last = point.time;
  }
  if (segment.length) segments.push(segment);
  return segments;
}

import {
  METRIC_FIELDS,
  TELEMETRY_INTERVAL,
  TELEMETRY_LIMIT,
  captureBaseline,
  cleanMetricsBaseline,
} from "./telemetry.mjs";

const known = (value) => Number.isFinite(value) && value >= 0;
const validHistory = (history) =>
  history?.version === 1 &&
  Array.isArray(history.fields) &&
  history.fields.length === METRIC_FIELDS.length &&
  history.fields.every((field, index) => field === METRIC_FIELDS[index]) &&
  Array.isArray(history.points);

// One copy per session, outside match/result/published snapshots. Each point
// is [sourceSeconds, [[accountId, team, ...eight metric values], ...]].
export function recordStatHistory(previous, point, force = false) {
  const history = validHistory(previous)
    ? previous
    : {
        version: 1,
        interval: TELEMETRY_INTERVAL,
        fields: [...METRIC_FIELDS],
        points: [],
      };
  if (!known(point?.time)) return history;
  const last = history.points.at(-1);
  if (last && point.time < last[0]) return history;
  if (last && !force && point.time - last[0] < TELEMETRY_INTERVAL)
    return history;
  const sample = [
    point.time,
    (Array.isArray(point.players) ? point.players : [])
      .slice(0, 12)
      .map((player) => [
        String(player.id),
        player.team,
        ...METRIC_FIELDS.map((field) =>
          known(player[field]) ? player[field] : null,
        ),
      ]),
  ];
  const points =
    last && point.time === last[0]
      ? [...history.points.slice(0, -1), sample]
      : [...history.points, sample];
  return { ...history, points: points.slice(-TELEMETRY_LIMIT) };
}

function baselineAt(sample) {
  if (
    !Array.isArray(sample) ||
    sample.length !== 2 ||
    !known(sample[0]) ||
    !Array.isArray(sample[1]) ||
    sample[1].length !== 12 ||
    sample[1].some(
      (row) => !Array.isArray(row) || row.length !== METRIC_FIELDS.length + 2,
    )
  )
    return null;
  return cleanMetricsBaseline({
    time: sample[0],
    players: sample[1].map((row) => ({
      id: row[0],
      team: row[1],
      ...Object.fromEntries(
        METRIC_FIELDS.map((field, index) => [field, row[index + 2]]),
      ),
    })),
  });
}

export function statHistoryRange(history) {
  if (!validHistory(history) || !history.points.length) return null;
  const times = history.points.map((point) => point?.[0]).filter(known);
  return times.length
    ? { first: times[0], last: times.at(-1), interval: TELEMETRY_INTERVAL }
    : null;
}

export function selectStatBaseline(session, request, now = Date.now()) {
  const keys = ["from", "lookbackSeconds", "startTime"];
  if (
    !request ||
    typeof request !== "object" ||
    Array.isArray(request) ||
    Object.keys(request).length !== 1 ||
    !keys.some((key) => Object.hasOwn(request, key))
  )
    throw Error("Choose one start: now, a lookback, or a game time.");
  if (Object.hasOwn(request, "from") && request.from !== "now")
    throw Error("Choose a valid start time.");

  const ended = Boolean(
    session?.result || session?.ended || session?.status === "finished",
  );
  if (
    !ended &&
    (session?.status !== "live" ||
      !known(session.updatedAt) ||
      !known(now) ||
      now < session.updatedAt ||
      now - session.updatedAt > 15000)
  )
    throw Error("Wait for a fresh live observation before setting the start.");
  const match = session?.result?.match || session?.match;
  const current = captureBaseline(match);
  const history = session?.statHistory;
  const range = statHistoryRange(history);
  if (!current) throw Error("Wait for a complete twelve-player observation.");
  if (range && current.time < range.last)
    throw Error("The source clock moved backwards. Wait for it to catch up.");

  let target = current.time;
  if (Object.hasOwn(request, "lookbackSeconds")) {
    if (!known(request.lookbackSeconds))
      throw Error("Choose a nonnegative lookback in game seconds.");
    target -= request.lookbackSeconds;
  } else if (Object.hasOwn(request, "startTime")) {
    if (!known(request.startTime))
      throw Error("Choose a nonnegative game time in seconds.");
    target = request.startTime;
  }
  if (target < 0 || target > current.time)
    throw Error("Choose a start within this game's recorded time.");

  const candidates = validHistory(history)
    ? history.points
        .filter(
          (sample) =>
            known(sample?.[0]) &&
            sample[0] <= target &&
            target - sample[0] <= TELEMETRY_INTERVAL,
        )
        .map(baselineAt)
        .filter(Boolean)
    : [];
  // Several source frames can share one game-clock timestamp. The latest
  // current observation must win a tie with the older sampled history row.
  if (current.time <= target) candidates.unshift(current);
  candidates.sort((first, second) => second.time - first.time);
  const baseline = candidates[0];
  if (!baseline)
    throw Error(
      "No complete observation is available within five seconds before that time. Choose a recorded start.",
    );
  const identities = new Map(
    current.players.map((player) => [player.id, player.team]),
  );
  if (
    baseline.players.some((player) => identities.get(player.id) !== player.team)
  )
    throw Error(
      "The recorded lineup differs. Choose a start with the current teams.",
    );
  return baseline;
}

export function collectorSessionView(session) {
  if (!session) return null;
  const { statHistory, ...view } = session;
  return { ...view, statHistoryRange: statHistoryRange(statHistory) };
}

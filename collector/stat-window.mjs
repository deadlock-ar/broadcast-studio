import { changesSince, METRIC_FIELDS } from "./telemetry.mjs";

// Keep the archive and graph on their original observations. Stat panels get
// an independent snapshot of counter changes from the operator's source-clock mark.
export function statWindowMatch(session, { stale = false } = {}) {
  const match = session?.result?.match || session?.match || null;
  const baseline = session?.settings?.metricsBaseline;
  if (!match || !baseline) return match;

  const ended = Boolean(
    session.result || session.ended || session.status === "finished",
  );
  const available = !stale && (ended || session.status === "live");
  const changes = available ? changesSince(match, baseline) : null;
  return {
    ...match,
    // Finished API matches normally resolve samples in playersAt(). These
    // values are already a snapshot; retain live status for ongoing captures.
    mode: match.mode === "live" ? "live" : "snapshot",
    players: (match.players || []).map((player) => ({
      ...player,
      ...Object.fromEntries(
        METRIC_FIELDS.map((metric) => [
          metric,
          changes?.get(String(player.id))?.[metric] ?? null,
        ]),
      ),
    })),
  };
}

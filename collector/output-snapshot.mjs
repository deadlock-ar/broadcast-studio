const finiteTime = (value) => Number.isFinite(value) && value >= 0;
const soulsOnly = (team) => ({
  souls: Number.isFinite(team?.souls) && team.souls >= 0 ? team.souls : null,
});

// Do not repeat a whole match history on outputs that do not render it. Build
// independent projections so queued outputs cannot mutate an archived result.
export function publicCollectorMatch(match, channel) {
  if (!match) return null;
  const { telemetry, metricFrame, ...current } = match;
  const output = structuredClone(current);
  if (channel !== "momentum") return output;
  if (metricFrame) output.metricFrame = structuredClone(metricFrame);
  if (!telemetry) return output;
  const points = Array.isArray(telemetry.points) ? telemetry.points : [];
  const latest = Math.max(
    finiteTime(metricFrame?.time) ? metricFrame.time : 0,
    finiteTime(points.at(-1)?.time) ? points.at(-1).time : 0,
  );
  output.telemetry = {
    version: telemetry.version,
    interval: telemetry.interval,
    points: points.map((point) => ({
      time: point.time,
      teams: Array.isArray(point.teams) ? point.teams.map(soulsOnly) : null,
      ...(finiteTime(point.time) &&
      point.time >= latest - 65 &&
      Array.isArray(point.players)
        ? {
            players: point.players.map((player) => ({
              id: player.id,
              team: player.team,
              ...soulsOnly(player),
            })),
          }
        : {}),
    })),
  };
  return output;
}

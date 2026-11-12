import { useState } from "react";
import { clock } from "./stats.js";
import { captureBaseline } from "../collector/telemetry.mjs";

const choices = [
  ["now", "Now"],
  ["30", "30 seconds ago"],
  ["60", "1 minute ago"],
  ["120", "2 minutes ago"],
  ["300", "5 minutes ago"],
  ["custom", "Specific game time"],
];

export default function StatWindowControls({
  session,
  busy,
  now,
  onStart,
  onTotals,
}) {
  const [start, setStart] = useState("now");
  const [gameTime, setGameTime] = useState("");
  const match = session.result?.match || session.match;
  const range = session.statHistoryRange;
  const current = match?.metricFrame?.time;
  const ended = Boolean(
    session.result || session.ended || session.status === "finished",
  );
  const fresh =
    ended || (session.status === "live" && now - session.updatedAt <= 15000);
  const parsed = /^(\d{1,4}):([0-5]\d)$/.exec(gameTime.trim());
  const customTime = parsed ? Number(parsed[1]) * 60 + Number(parsed[2]) : null;
  const target =
    start === "now"
      ? current
      : start === "custom"
        ? customTime
        : current - Number(start);
  const inHistory =
    Number.isFinite(target) &&
    target >= 0 &&
    target <= 86400 &&
    target <= current &&
    range &&
    target >= range.first;
  const available =
    fresh && captureBaseline(match) && (start === "now" ? !ended : inHistory);
  const request =
    start === "now"
      ? { from: "now" }
      : start === "custom"
        ? { startTime: customTime }
        : { lookbackSeconds: Number(start) };
  const selectedLabel = choices.find(([value]) => value === start)?.[1];
  const marked = Boolean(session.settings.metricsBaseline);

  return (
    <div className="production-range-controls">
      <div className="production-range-summary">
        <strong>
          {marked
            ? `Stats since ${clock(session.settings.metricsBaseline.time)}`
            : "Whole-match stats"}
        </strong>
        <p>
          Choose where the fight stats begin. The start stays fixed until you
          restart.
        </p>
      </div>
      <label>
        Start from
        <select
          aria-label="Record stats from"
          value={start}
          onChange={(e) => setStart(e.target.value)}
        >
          {choices.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {start === "custom" && (
        <label>
          Game time (M:SS)
          <input
            aria-label="Stats start game time"
            value={gameTime}
            onChange={(e) => setGameTime(e.target.value)}
            placeholder="12:30"
            maxLength={7}
          />
        </label>
      )}
      <button
        className="button primary"
        disabled={busy || !available}
        onClick={() => onStart(request)}
      >
        {start === "now"
          ? `${marked ? "Restart" : "Start"} recording from now`
          : start === "custom"
            ? `${marked ? "Restart" : "Start"} from game time`
            : `${marked ? "Restart" : "Start"} from ${selectedLabel}`}
      </button>
      <button
        className="button secondary"
        disabled={busy || !marked}
        onClick={onTotals}
      >
        Show whole-match stats
      </button>
      <small className="production-range-coverage">
        {range
          ? `Recorded history: ${clock(range.first)}–${clock(range.last)} · uses the nearest earlier sample, within ${range.interval} seconds.`
          : "Earlier start times become available as stats are recorded."}
        {start === "custom" && gameTime && !parsed
          ? " Enter a game time such as 12:30."
          : ""}
        {start !== "now" && Number.isFinite(target) && !inHistory
          ? " That start time is outside the recorded history."
          : ""}
      </small>
    </div>
  );
}

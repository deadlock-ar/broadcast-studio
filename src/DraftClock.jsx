import { useEffect, useState } from "react";
import {
  advanceDraftClock,
  draftClockTime,
  DRAFT_CLOCK_HANDOFF_MS,
} from "./draft-clock.js";

export default function DraftClock({
  snapshot,
  connected,
  enabled,
  teams,
  team,
}) {
  const live = connected && enabled;
  const [saved, setSaved] = useState(() =>
    advanceDraftClock(null, snapshot, live, 0),
  );
  let state = saved;
  // Adjust to new input before rendering so no empty intermediate frame is painted.
  if (saved.snapshot !== snapshot || saved.connected !== live) {
    state = advanceDraftClock(saved, snapshot, live, 0);
    setSaved(state);
  }
  useEffect(() => {
    if (!state.pendingUntil) return;
    const expires = state.pendingUntil;
    const timer = setTimeout(
      () =>
        setSaved((previous) =>
          advanceDraftClock(
            previous,
            previous.snapshot,
            previous.connected,
            expires,
          ),
        ),
      DRAFT_CLOCK_HANDOFF_MS,
    );
    return () => clearTimeout(timer);
  }, [state.pendingUntil]);
  const frame = state.teamFrames[team];
  const active =
    snapshot?.status === "ACTIVE" &&
    snapshot.steps?.[snapshot.currentStepIndex]?.teamNumber === team;
  if (!enabled || snapshot?.status === "COMPLETED") return null;
  return (
    <div
      className={`draft-clock team-draft-clock ${active ? "is-active" : ""}`}
      aria-label={`${teams[team - 1].name} draft timers`}
      data-team={team}
      aria-busy={Boolean(state.pendingUntil)}
      data-clock-state={
        state.pendingUntil ? "handoff" : frame ? "ready" : "unavailable"
      }
    >
      <div className="draft-clock-readout">
        <span className="draft-timer">
          <span className="draft-step-clock">
            <small>TURN</small>
            <strong className="draft-step-time">
              {draftClockTime(frame?.seconds)}
            </strong>
          </span>
          <small className="draft-reserve">
            <span>RESERVE</span>
            <strong>
              {Number.isFinite(frame?.reserve) ? Math.ceil(frame.reserve) : "—"}
              <span>s</span>
            </strong>
          </small>
        </span>
      </div>
    </div>
  );
}

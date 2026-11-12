export const DRAFT_CLOCK_HANDOFF_MS = 2000;

export function draftClockPhase(snapshot) {
  const active = snapshot?.steps?.[snapshot.currentStepIndex];
  return {
    status: snapshot?.status,
    team: snapshot?.status === "ACTIVE" ? active?.teamNumber : null,
    type: active?.selectionType,
  };
}

export function draftClockLabel(phase, teams) {
  if (phase.status === "COMPLETED") return "Draft complete";
  if (phase.status === "PAUSED") return "Draft paused";
  if (phase.team)
    return `${teams[phase.team - 1].name} ${phase.type === "ban" ? "banning" : "picking"}`;
  return "Waiting for the draft";
}

// This is a presentation hold, never an estimated countdown. Keep the old
// team's label and both numbers together until the next team's clock arrives.
export function advanceDraftClock(previous, snapshot, connected, now) {
  const phase = draftClockPhase(snapshot);
  const room = snapshot?.draftCode || "";
  const step = snapshot?.currentStepIndex ?? -1;
  const turn = `${room}:${step}:${snapshot?.steps?.[step]?.id || ""}`;
  const reset =
    previous &&
    (previous.room !== room ||
      step < previous.step ||
      previous.snapshot?.status !== "ACTIVE" ||
      !previous.connected);
  const timer = snapshot?.currentTimer;
  const timerTeam = Number(timer?.activeTeam);
  const seconds = timer?.[`team${timerTeam}StepTimer`];
  const reserve = timer?.[`team${timerTeam}ReserveTimer`];
  const ready =
    connected &&
    (phase.status === "ACTIVE"
      ? timerTeam === phase.team
      : phase.status === "PAUSED" && [1, 2].includes(timerTeam)) &&
    Number.isFinite(seconds);
  const next = {
    snapshot,
    connected,
    room,
    step,
    frame: null,
    pendingUntil: null,
  };
  if (ready) {
    next.frame = {
      turn,
      phase,
      seconds: Math.max(0, seconds),
      reserve: Number.isFinite(reserve)
        ? Math.max(0, reserve)
        : !reset && previous?.frame?.turn === turn
          ? previous.frame.reserve
          : null,
    };
  } else if (
    connected &&
    phase.status === "ACTIVE" &&
    !reset &&
    previous?.frame
  ) {
    const until = previous.pendingUntil ?? now + DRAFT_CLOCK_HANDOFF_MS;
    if (now < until) {
      next.frame = previous.frame;
      next.pendingUntil = until;
    }
  }
  // Each side owns its last source values. Inactive clocks stay frozen instead
  // of moving to the other team's display when the turn changes.
  const retainTeams =
    connected &&
    ["ACTIVE", "PAUSED"].includes(phase.status) &&
    previous?.room === room &&
    step >= previous.step &&
    previous.connected &&
    ["ACTIVE", "PAUSED"].includes(previous.snapshot?.status);
  next.teamFrames = retainTeams ? { ...previous.teamFrames } : {};
  if (connected && ["ACTIVE", "PAUSED"].includes(phase.status)) {
    for (const team of [1, 2]) {
      if (team === phase.team && !ready) continue;
      const teamSeconds = timer?.[`team${team}StepTimer`];
      const teamReserve = timer?.[`team${team}ReserveTimer`];
      if (!Number.isFinite(teamSeconds) && !Number.isFinite(teamReserve))
        continue;
      const old = next.teamFrames[team];
      next.teamFrames[team] = {
        seconds: Number.isFinite(teamSeconds)
          ? Math.max(0, teamSeconds)
          : (old?.seconds ?? null),
        reserve: Number.isFinite(teamReserve)
          ? Math.max(0, teamReserve)
          : (old?.reserve ?? null),
      };
    }
    if (next.frame) {
      const team = next.frame.phase.team || timerTeam;
      next.teamFrames[team] = {
        seconds: next.frame.seconds,
        reserve: next.frame.reserve,
      };
    } else if (phase.team) delete next.teamFrames[phase.team];
  }
  return next;
}

export function draftClockTime(seconds) {
  if (!Number.isFinite(seconds)) return "—";
  const value = Math.floor(Math.max(0, seconds));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

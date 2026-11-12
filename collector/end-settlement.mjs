// Game-over notification can precede the final controller/clock fields. Wait
// in recording time, so decoding an entire file in one burst is still safe.
export function settleEndFrame(state, frame, sourceClockMs, finalize = false) {
  const positiveClock = Number.isFinite(frame.duration) && frame.duration > 0;
  if (positiveClock)
    state.lastDuration = Math.max(state.lastDuration || 0, frame.duration);
  const complete =
    frame.players?.length === 12 &&
    new Set(frame.players.map((player) => player.id)).size === 12;
  if (complete) state.lastComplete = structuredClone(frame);
  if (!frame.endObserved) return frame;
  state.signaledAt ??= sourceClockMs;
  const validClock =
    (positiveClock && frame.duration >= (state.lastDuration || 0) - 1) ||
    !state.lastDuration;
  const elapsed =
    Number.isFinite(sourceClockMs) && Number.isFinite(state.signaledAt)
      ? sourceClockMs - state.signaledAt
      : 0;
  if (!finalize && (!complete || !validClock || elapsed < 1500))
    return { ...frame, endObserved: false };
  const result = complete ? frame : state.lastComplete || frame;
  const needsClockFallback =
    !Number.isFinite(result.duration) ||
    (result.duration === 0 && state.lastDuration > 0);
  state.settled = true;
  return {
    ...result,
    endObserved: true,
    ...(needsClockFallback && Number.isFinite(state.lastDuration)
      ? {
          duration: Math.round(state.lastDuration),
          durationEvidence: "last-observed-before-game-over",
        }
      : {}),
  };
}

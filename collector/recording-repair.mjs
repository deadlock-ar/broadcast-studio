// A reparse may fill missing detail, but must never change a game's identity,
// outcome, counters, presentation, or bracket/series awards.
export function repairRecording(session, value, catalog, now = Date.now()) {
  const original = session.result?.match;
  const frame = value?.frame;
  const fail = () => {
    throw Error("This repair does not match the saved finished recording.");
  };
  if (
    value?.version !== 1 ||
    value?.kind !== "deadlock-recording-repair" ||
    !original ||
    !original.matchId ||
    !Number.isFinite(original.duration) ||
    !Array.isArray(original.players) ||
    original.players.length !== 12 ||
    original.players.some((p) => !p || typeof p.id !== "string") ||
    new Set(original.players.map((p) => p.id)).size !== 12 ||
    ![0, 1].every(
      (team) => original.players.filter((p) => p.team === team).length === 6,
    ) ||
    frame?.matchId !== original.matchId ||
    frame.endObserved !== true ||
    frame.winner !== session.result.winner ||
    !Number.isSafeInteger(frame.tick) ||
    frame.tick < 0 ||
    !Number.isFinite(frame.duration) ||
    frame.duration < 0 ||
    Math.abs(frame.duration - original.duration) > 1 ||
    !Array.isArray(frame.players) ||
    frame.players.length !== 12 ||
    frame.players.some((p) => !p || typeof p.id !== "string") ||
    new Set(frame.players.map((p) => p.id)).size !== 12
  )
    fail();
  const itemIds = new Set(catalog.map((i) => i.id));
  const players = original.players.map((old) => {
    const next = frame.players.find((p) => p.id === old.id);
    if (
      !next ||
      [
        "team",
        "heroId",
        "kills",
        "deaths",
        "assists",
        "souls",
        "damage",
        "healing",
        "objectiveDamage",
      ].some((key) => next[key] !== old[key])
    )
      fail();
    if (
      !Array.isArray(next.items) ||
      next.items.length > 24 ||
      next.items.some((id) => !itemIds.has(id))
    )
      fail();
    if (
      !Array.isArray(next.abilities) ||
      next.abilities.length !== 4 ||
      next.abilities.some(
        (a, i) =>
          !a ||
          a.slot !== i + 1 ||
          a.id !== old.abilities?.[i]?.id ||
          ![null, 0, 1, 2, 3].includes(a.level) ||
          ![null, true, false].includes(a.unlocked),
      )
    )
      fail();
    return {
      ...old,
      items: [...new Set(next.items)],
      abilities: next.abilities.map(({ slot, id, level, unlocked }) => ({
        slot,
        id,
        level,
        unlocked,
      })),
    };
  });
  const history = value.items;
  const roster = new Set(players.map((p) => p.id));
  if (
    !Array.isArray(history?.purchases) ||
    history.purchases.length > 10000 ||
    typeof history.fromStart !== "boolean" ||
    history.fromStart !== session.recording?.fromStart ||
    history.purchases.some((p) => !p || typeof p.id !== "string") ||
    new Set(history.purchases.map((p) => p.id)).size !==
      history.purchases.length
  )
    fail();
  const purchases = history.purchases.map((row) => {
    if (
      typeof row.id !== "string" ||
      !row.id.length ||
      row.id.length > 120 ||
      !roster.has(row.playerId) ||
      !itemIds.has(row.itemId) ||
      !["pending", "confirmed", "refunded", "review"].includes(row.status) ||
      !Number.isSafeInteger(row.tick) ||
      row.tick < 0 ||
      row.tick > frame.tick
    )
      fail();
    const old = session.items?.purchases?.find((p) => p.id === row.id);
    const correction =
      old?.playerId === row.playerId && old?.itemId === row.itemId
        ? session.itemReviews?.[row.id]
        : null;
    return {
      ...structuredClone(row),
      evidence: String(row.evidence || "").slice(0, 200),
      ...(correction || {}),
    };
  });
  const repair = {
    source: String(value.source || "Local recording").slice(0, 160),
    repairedAt: now,
    parserVersion: String(value.parserVersion || "").slice(0, 80),
  };
  session.result = {
    ...session.result,
    match: { ...original, players },
    recordingRepair: repair,
  };
  session.match = { ...session.match, players: structuredClone(players) };
  session.items = {
    ...structuredClone(history),
    purchases,
    reviewCount: purchases.filter((p) =>
      ["pending", "review"].includes(p.status),
    ).length,
  };
  session.message =
    "Recording details repaired. Review and publish the updated scoreboard.";
  return session;
}

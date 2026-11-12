const fail = () => {
  throw Error("Recorded source breakdown does not match this game.");
};
const amount = (value) =>
  value === null || (Number.isFinite(value) && value >= 0 && value <= 1e12);

export function cleanRecordedSources(value) {
  if (
    value?.version !== 1 ||
    value.source !== "recording-post-match" ||
    !/^\d{1,15}$/.test(value.matchId || "") ||
    !Number.isFinite(value.duration) ||
    value.duration <= 0 ||
    value.duration > 86400 ||
    !Array.isArray(value.players) ||
    value.players.length !== 12 ||
    value.players.some((p) => !p || !/^\d{1,10}$/.test(p.id || "")) ||
    new Set(value.players.map((p) => p.id)).size !== 12
  )
    fail();
  const players = value.players.map((p) => {
    if (
      !Number.isInteger(p.slot) ||
      ![0, 1].includes(p.team) ||
      !Number.isInteger(p.heroId) ||
      !Number.isFinite(p.sampleTime) ||
      Math.abs(p.sampleTime - value.duration) > 3 ||
      !Array.isArray(p.soulsBySource) ||
      p.soulsBySource.length < 1 ||
      p.soulsBySource.length > 32 ||
      new Set(p.soulsBySource.map((s) => s?.source)).size !==
        p.soulsBySource.length
    )
      fail();
    const soulsBySource = p.soulsBySource.map((s) => {
      if (
        !s ||
        !Number.isInteger(s.source) ||
        s.source < 0 ||
        s.source > 128 ||
        !amount(s.gold) ||
        !amount(s.knownGold) ||
        typeof s.complete !== "boolean" ||
        (s.complete && (s.gold === null || s.knownGold !== s.gold)) ||
        (!s.complete && s.gold !== null)
      )
        fail();
      return {
        source: s.source,
        label: String(s.label || `Source ${s.source}`).slice(0, 50),
        gold: s.gold,
        knownGold: s.knownGold,
        complete: s.complete,
      };
    });
    return {
      id: p.id,
      slot: p.slot,
      team: p.team,
      heroId: p.heroId,
      sampleTime: p.sampleTime,
      soulsBySource,
    };
  });
  if (
    ![0, 1].every((team) => players.filter((p) => p.team === team).length === 6)
  )
    fail();
  return {
    version: 1,
    source: value.source,
    matchId: value.matchId,
    duration: value.duration,
    players,
  };
}

export function validateRecordedSources(value, match, finished = false) {
  const clean = cleanRecordedSources(value);
  if (
    !match ||
    match.matchId !== clean.matchId ||
    !Array.isArray(match.players) ||
    match.players.length !== 12 ||
    new Set(match.players.map((p) => p.id)).size !== 12 ||
    clean.players.some(
      (source) =>
        !match.players.some((p) =>
          ["id", "slot", "team", "heroId"].every(
            (key) => p[key] === source[key],
          ),
        ),
    ) ||
    (finished &&
      (!Number.isFinite(match.duration) ||
        Math.abs(clean.duration - match.duration) > 3))
  )
    fail();
  return clean;
}

export function applyRecordedSources(session, value, now = Date.now()) {
  const match = session.result?.match || session.match;
  const clean = validateRecordedSources(value, match, Boolean(session.result));
  const add = (players) =>
    players.map((p) => ({
      ...p,
      soulsBySource: structuredClone(
        clean.players.find((source) => source.id === p.id).soulsBySource,
      ),
    }));
  const provenance = {
    source: clean.source,
    matchId: clean.matchId,
    duration: clean.duration,
    receivedAt: now,
  };
  session.match = { ...session.match, players: add(session.match.players) };
  if (session.result)
    session.result = {
      ...session.result,
      match: {
        ...session.result.match,
        players: add(session.result.match.players),
      },
      sourceBreakdown: provenance,
    };
  session.sourceBreakdown = { ...clean, receivedAt: now };
  return session;
}

export function publishRecordedSources(session, now = Date.now()) {
  if (!session.published || !session.result?.sourceBreakdown) fail();
  const sources = validateRecordedSources(
    session.sourceBreakdown,
    session.published.match,
    true,
  );
  session.published = {
    ...session.published,
    match: {
      ...session.published.match,
      players: session.published.match.players.map((p) => ({
        ...p,
        soulsBySource: structuredClone(
          sources.players.find((source) => source.id === p.id).soulsBySource,
        ),
      })),
    },
    sourceBreakdown: structuredClone(session.result.sourceBreakdown),
    sourcesPublishedAt: now,
  };
  return session;
}

export function captureCoverage(session) {
  const match = session?.result?.match || session?.match;
  const players = match?.players || [];
  const inventories = players.filter((p) => Array.isArray(p.items)).length;
  const abilityPlayers = players.filter(
    (p) =>
      p.abilities?.length === 4 &&
      p.abilities.every(
        (a) => Number.isInteger(a.level) || a.unlocked === false,
      ),
  ).length;
  const sourcePlayers = players.filter((p) =>
    p.soulsBySource?.some(
      (s) => Number.isFinite(s.gold) || Number.isFinite(s.knownGold),
    ),
  ).length;
  const ended = Boolean(session?.result || session?.ended);
  const imported =
    session?.mode === "offline" || session?.result?.captureMode === "offline";
  const messages = [];
  if (session?.sourceBreakdownError)
    messages.push(
      "The end-of-match source details could not be read. Update the observer and replay the saved recording to recover them.",
    );
  if (players.length !== 12)
    messages.push(`Only ${players.length} of 12 players are available.`);
  if (inventories < 12)
    messages.push(
      imported
        ? "This imported source does not supply final held items."
        : `Final held items are missing for ${12 - inventories} player${inventories === 11 ? "" : "s"}.`,
    );
  if (abilityPlayers < 12)
    messages.push(
      imported
        ? "This imported source does not supply ability levels."
        : `Ability levels are incomplete for ${12 - abilityPlayers} player${abilityPlayers === 11 ? "" : "s"}.`,
    );
  if (sourcePlayers < 12)
    messages.push(
      ended
        ? "Souls by source is not available for every player. Missing values are omitted from the broadcast."
        : "Souls by source is checked when the recording receives the end-of-match details.",
    );
  const purchases = session?.items?.purchases || [];
  const unverifiedPurchases = purchases.filter((p) =>
    ["pending", "review"].includes(p.status),
  ).length;
  if (unverifiedPurchases && ended)
    messages.push(
      `${unverifiedPurchases} unverified purchase${unverifiedPurchases === 1 ? " is" : "s are"} automatically omitted from top items.`,
    );
  return {
    players: players.length,
    inventories,
    abilityPlayers,
    sourcePlayers,
    ended,
    imported,
    unverifiedPurchases,
    messages,
  };
}

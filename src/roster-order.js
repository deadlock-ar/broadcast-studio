// Shared by the live HUD and the match overlay so identity-based calibration
// always moves a player's portrait and name together.
export function liveRoster(session) {
  const order = session?.settings?.hudOrder || [];
  const position = (p) =>
    order.includes(p.id) ? order.indexOf(p.id) : 100 + p.slot;
  return [...(session?.match?.players || [])].sort(
    (a, b) =>
      a.team - b.team || position(a) - position(b) || a.id.localeCompare(b.id),
  );
}

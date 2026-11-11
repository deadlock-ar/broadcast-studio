import { cleanUltimateBadges } from "../collector/ultimate-settings.mjs";

export function collectorUltimatePreferences(value, selectedId) {
  const session = value?.session || value;
  if (
    typeof session?.id !== "string" ||
    !session.id ||
    (selectedId !== undefined && session.id !== selectedId)
  )
    return null;
  return {
    id: session.id,
    ultimateBadges: cleanUltimateBadges(session.settings?.ultimateBadges),
  };
}

// Production preferences are immediate; source frames and their clocks remain
// delayed. Reapply this projection whenever an older queued frame is released.
export function applyCollectorUltimatePreferences(value, preferences) {
  const session = value?.session || value;
  if (!session?.id || session.id !== preferences?.id) return value;
  const current = cleanUltimateBadges(session.settings?.ultimateBadges);
  if (JSON.stringify(current) === JSON.stringify(preferences.ultimateBadges))
    return value;
  const projected = {
    ...session,
    settings: {
      ...session.settings,
      ultimateBadges: preferences.ultimateBadges,
    },
  };
  return value.session ? { ...value, session: projected } : projected;
}

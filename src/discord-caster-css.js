import { casterSlots, cleanDiscordUserId } from "./caster-stage.js";

export const FIXED_CASTER_SLOTS = Object.fromEntries(
  [1, 2, 3, 4].map((count) => [
    count,
    casterSlots(count).map((slot) => ({
      left: slot.x + slot.width / 2 - 108,
      top: slot.y + slot.height / 2 - 108,
    })),
  ]),
);

export function casterIdsError(count, values) {
  if (![1, 2, 3, 4].includes(count)) return "Choose between 1 and 4 casters.";
  const ids = Array.from({ length: count }, (_, i) =>
    typeof values?.[i] === "string" ? values[i].trim() : "",
  );
  if (ids.some((id) => !id))
    return "Enter a Discord user ID for every caster slot.";
  if (ids.some((id) => !cleanDiscordUserId(id)))
    return "Use Copy User ID from Discord: a 17–20 digit account ID, not a name or Steam ID.";
  if (new Set(ids).size !== count)
    return "Each slot must use a different Discord user ID.";
  return "";
}

export function fixedCasterCss(count, values) {
  const error = casterIdsError(count, values);
  if (error) throw Error(error);
  const ids = values.slice(0, count).map((id) => id.trim());
  const positions = ids
    .map(
      (id, i) =>
        `.voice_state[data-userid="${id}"] { display: block !important; left: ${FIXED_CASTER_SLOTS[count][i].left.toFixed(6)}px !important; top: ${FIXED_CASTER_SLOTS[count][i].top.toFixed(6)}px !important; }`,
    )
    .join("\n");
  return `/* FIXED ${count}-CASTER DESK — only these Discord accounts can appear.
OBS Voice Browser Source: 1920 x 1080. Position X 0 / Y 0.
Top-left alignment. Scale 1. No crop. No bounding box. Above the desk.
Desk: Discord speaking avatars, ${count} casters. Speaking Users Only OFF.
Slot assignment is by user ID, never by room order, username or nickname. */
html, body, #root {
  width: 1920px !important; height: 1080px !important;
  margin: 0 !important; padding: 0 !important;
  background: transparent !important; overflow: hidden !important;
}
.voice_container, .voice_states {
  position: absolute !important; inset: 0 !important;
  display: block !important; width: 1920px !important;
  height: 1080px !important; margin: 0 !important;
  padding: 0 !important; list-style: none !important;
  background: transparent !important; box-sizing: border-box !important;
}
.voice_state {
  display: none !important;
  position: absolute !important; width: 216px !important;
  height: 216px !important; margin: 0 !important; padding: 10px !important;
  box-sizing: border-box !important; border: 1px solid #b4af8a !important;
  border-radius: 50% !important; background: #182720 !important;
  box-shadow: 0 0 0 10px #67714a21, 0 0 0 11px #a4aa7745 !important;
  transition: box-shadow 150ms, border-color 150ms !important;
}
${positions}
.voice_avatar {
  display: block !important; float: none !important;
  width: 194px !important; height: 194px !important;
  max-width: none !important; margin: 0 !important; padding: 0 !important;
  box-sizing: border-box !important; object-fit: cover !important;
  border: 0 !important; border-radius: 50% !important;
  box-shadow: none !important; filter: brightness(.86) saturate(.8);
  transition: filter 150ms !important;
}
.voice_state.wrapper_speaking {
  border-color: #e4cf90 !important;
  box-shadow: 0 0 0 10px #e4cf9038, 0 0 0 12px #e4cf90, 0 0 45px #e4cf9080 !important;
}
.voice_state.wrapper_speaking .voice_avatar { filter: none !important; }
.voice_username { display: none !important; }
`;
}

import { safeImage } from "./draft.js";

export const DEFAULT_TEAM_ICON = "/team-default.png";

// Keep the bundled fallback out of saved branding so a real logo always wins.
export const teamLogo = (value) => safeImage(value) || DEFAULT_TEAM_ICON;

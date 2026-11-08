import { DEFAULT_TEAM_ICON, teamLogo } from "./team-identity.js";

export default function TeamLogo({ logo, alt = "", className, ...props }) {
  return (
    <img
      {...props}
      className={className}
      src={teamLogo(logo)}
      alt={alt}
      onError={(event) => {
        if (event.currentTarget.getAttribute("src") !== DEFAULT_TEAM_ICON)
          event.currentTarget.src = DEFAULT_TEAM_ICON;
      }}
    />
  );
}

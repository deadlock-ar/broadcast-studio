import { StatGraphic } from "./StatPanels.jsx";
import SoulsDifferencePanel from "./SoulsDifferencePanel.jsx";
import { statWindowMatch } from "../collector/stat-window.mjs";

export default function CollectorPanel({
  session,
  panel,
  stale = false,
  status,
}) {
  if (panel.content === "souls-graph")
    return (
      <SoulsDifferencePanel session={session} panel={panel} stale={stale} />
    );
  const match = statWindowMatch(session, { stale });
  return (
    <StatGraphic
      match={match}
      panel={panel}
      time={match?.duration}
      status={
        status ||
        (session?.ended || session?.result ? "finished" : session?.status)
      }
      stale={stale}
      rangeStart={session?.settings?.metricsBaseline?.time ?? null}
    />
  );
}

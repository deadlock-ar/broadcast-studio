import { StatGraphic } from "./StatPanels.jsx";
import SoulsDifferencePanel from "./SoulsDifferencePanel.jsx";
import { statWindowMatch } from "../collector/stat-window.mjs";
import PanelTransition from "./PanelTransition.jsx";

export default function CollectorPanel({
  session,
  panel,
  stale = false,
  status,
  visible = true,
}) {
  const match = statWindowMatch(session, { stale });
  return (
    <PanelTransition visible={visible} identity={session?.id}>
      {panel.content === "souls-graph" ? (
        <SoulsDifferencePanel session={session} panel={panel} stale={stale} />
      ) : (
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
      )}
    </PanelTransition>
  );
}

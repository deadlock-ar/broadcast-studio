import SoulsGraph from "./SoulsGraph.jsx";
import { cleanPanel, clock } from "./stats.js";
import { usePanelPlacement } from "./use-panel-placement.js";
import "./StatPanels.css";
import "./SoulsDifferencePanel.css";

export default function SoulsDifferencePanel({
  session,
  panel,
  stale = false,
}) {
  const settings = cleanPanel(panel);
  const placement = usePanelPlacement(settings);
  const match = session?.result?.match || session?.match;
  const ended = Boolean(
    session?.result?.match ||
      session?.ended ||
      session?.status === "finished" ||
      match?.mode === "finished" ||
      match?.endObserved,
  );
  const paused = !ended && (stale || session?.status !== "live");
  const stateLabel = ended ? "FINAL" : paused ? "FEED PAUSED" : "LIVE";
  const title = settings.title || "Souls difference";
  const sourceClock = Number.isFinite(match?.duration)
    ? clock(match.duration)
    : "—";
  const graphWidth = Math.max(160, settings.width - 26);

  return (
    <div className="stat-canvas souls-difference-canvas">
      <section
        ref={placement}
        className={`stat-box stat-viewport-fit souls-difference-box stat-theme-${settings.theme} stat-position-${settings.position}`}
        data-compact={settings.width < 480}
        style={{
          "--panel-scale": settings.scale,
          "--panel-width": `${settings.width}px`,
          "--stat-font-size": `${settings.fontSize}px`,
        }}
        aria-label={`${title} broadcast panel`}
      >
        <header className="stat-box-header souls-difference-heading">
          <h2 dir="auto" title={title}>
            {title}
          </h2>
          <div className="souls-difference-state">
            <b aria-label={`Match clock: ${sourceClock}`}>{sourceClock}</b>
            <span
              className={`stat-source-label${!ended && !paused ? " live" : ""}${paused ? " delayed" : ""}`}
            >
              {stateLabel}
            </span>
          </div>
        </header>
        <SoulsGraph
          telemetry={match?.telemetry}
          teamNames={settings.teamNames}
          width={graphWidth}
          height={160}
          fontSize={Math.max(10, Math.min(16, settings.fontSize * 0.65))}
        />
        <footer className="souls-difference-note">
          Recorded match history · gaps are unavailable
        </footer>
      </section>
    </div>
  );
}

import { useState } from "react";
import { useWorkspace } from "./workspace-context.js";
import { OUTPUTS } from "./workspace-model.js";
import BackupControls from "./BackupControls.jsx";
const labels = {
  draft: "Draft",
  "match-overlay": "Match overlay",
  "live-events": "Deadlock API stats",
  deadem: "Live stats panel",
  scoreboard: "Post-match scoreboard",
  ultimates: "Ultimate HUD",
  "hero-priority": "Hero priority",
  "top-items": "Top items",
  "series-mvp": "Series MVP",
};
export default function SharedOutputs() {
  const shared = useWorkspace();
  const [notice, setNotice] = useState("");
  return (
    <section className="cloud-output-links">
      <div className="page-heading">
        <div>
          <span className="eyebrow">SET UP ONCE / CONTROL FROM ANYWHERE</span>
          <h1>
            OBS outputs<span>✦</span>
          </h1>
          <p>
            Permanent links. Changes in the studio update these sources
            automatically.
          </p>
        </div>
      </div>
      {Object.entries(OUTPUTS)
        .filter(([key]) => key !== "live-events")
        .map(([key, path]) => {
          const url = new URL(path, window.location.origin).href;
          return (
            <article className="production-card cloud-output-row" key={key}>
              <div>
                <h2>{labels[key]}</h2>
                {key === "match-overlay" && <p>1920 × 102 · transparent</p>}
                <input
                  aria-label={`${labels[key]} permanent OBS URL`}
                  value={url}
                  readOnly
                  onFocus={(e) => e.target.select()}
                />
              </div>
              <button
                className="button secondary"
                onClick={() =>
                  navigator.clipboard
                    .writeText(url)
                    .then(() => setNotice(`${labels[key]} URL copied.`))
                    .catch(() =>
                      setNotice("Select the URL and copy it manually."),
                    )
                }
              >
                Copy URL
              </button>
              <a
                className="button secondary"
                href={url}
                target="_blank"
                rel="noreferrer"
              >
                Open output ↗
              </a>
            </article>
          );
        })}
      {notice && <p role="status">{notice}</p>}
      <p>
        Add the match overlay as a 1920 × 102 OBS Browser Source; use 1920 ×
        1080 for the other sources. Enable “Control audio via OBS” for the
        draft. The scoreboard follows the latest published result; the other
        outputs follow their current dashboard settings.
      </p>
      <p>
        {shared?.connected
          ? "Shared workspace connected."
          : "Reconnecting to the shared workspace…"}{" "}
        Close unused OBS browser sources and dashboard tabs between events so
        the service can sleep.
      </p>
      <BackupControls />
    </section>
  );
}

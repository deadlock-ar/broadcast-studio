import { useState } from "react";
import { useWorkspace } from "./workspace-context.js";
import { OUTPUTS } from "./workspace-model.js";
import BackupControls from "./BackupControls.jsx";
const labels = {
  draft: "Draft",
  "live-events": "Deadlock API stats",
  deadem: "Deadem stats",
  scoreboard: "Post-match scoreboard",
  ultimates: "Ultimate HUD",
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
            Five permanent links. Changes in the studio update these sources
            automatically.
          </p>
        </div>
      </div>
      {Object.entries(OUTPUTS).map(([key, path]) => {
        const url = new URL(path, window.location.origin).href;
        return (
          <article className="production-card cloud-output-row" key={key}>
            <div>
              <h2>{labels[key]}</h2>
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
        Add each link as a 1920 × 1080 OBS Browser Source. Enable “Control audio
        via OBS” for the draft. The scoreboard follows the latest published
        result; the other outputs follow their current dashboard settings.
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

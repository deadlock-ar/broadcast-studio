import { cleanPanel } from "./stats.js";
export default function PanelControls({ panel, setPanel }) {
  const update = (key, value) =>
    setPanel((old) => cleanPanel({ ...old, [key]: value }));
  return (
    <section className="production-card panel-customization">
      <h3>Panel appearance & placement</h3>
      <div className="production-calibration">
        <label>
          Layout
          <select
            value={panel.layout}
            onChange={(e) => update("layout", e.target.value)}
          >
            <option value="boxes">Player tiles</option>
            <option value="ranking">Ranked list</option>
            <option value="teams">Team columns</option>
          </select>
        </label>
        <label>
          Sort
          <select
            value={panel.sort}
            onChange={(e) => update("sort", e.target.value)}
          >
            <option value="value">Highest value</option>
            <option value="team">By team</option>
          </select>
        </label>
        <label>
          Theme
          <select
            value={panel.theme}
            onChange={(e) => update("theme", e.target.value)}
          >
            <option value="ink">Olive</option>
            <option value="parchment">Parchment</option>
          </select>
        </label>
        <label>
          Position
          <select
            value={panel.position}
            onChange={(e) => update("position", e.target.value)}
          >
            {[
              "top-left",
              "top-right",
              "bottom-left",
              "bottom-right",
              "center",
              "custom",
            ].map((v) => (
              <option key={v} value={v}>
                {v === "custom" ? "Exact X / Y" : v.replaceAll("-", " ")}
              </option>
            ))}
          </select>
        </label>
        {[
          ["scale", "Scale", 0.25, 2, 0.01],
          ["width", "Width (px)", 240, 1880, 1],
          ["fontSize", "Text size (px)", 12, 36, 1],
          ...(panel.position === "custom"
            ? [
                ["x", "X from left (px)", 0, 1919, 1],
                ["y", "Y from top (px)", 0, 1079, 1],
              ]
            : []),
        ].map(([key, label, min, max, step]) => (
          <label key={key}>
            {label}
            <input
              type="number"
              value={panel[key]}
              min={min}
              max={max}
              step={step}
              onChange={(e) => update(key, Number(e.target.value))}
            />
          </label>
        ))}
        <label>
          Panel title
          <input
            value={panel.title}
            maxLength={64}
            placeholder="Automatic from statistic"
            onChange={(e) => update("title", e.target.value)}
          />
        </label>
      </div>
      <p className="production-hint">
        Coordinates use a 1920 × 1080 canvas and the panel’s top-left corner.
        Changes are shared with admins and the OBS source.
      </p>
    </section>
  );
}

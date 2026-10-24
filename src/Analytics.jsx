import { useEffect, useMemo, useRef, useState } from "react";
import heroes from "./heroes.json";
import items from "./items.json";
import { draftPriority, itemPriority } from "./analytics.js";
import {
  drawHeroReport,
  drawItemReport,
  drawMvpReport,
  downloadCanvas,
} from "./report-canvas.js";
import { workspaceRequest, useWorkspaceField } from "./workspace-context.js";
import "./Analytics.css";

export default function Analytics({ active, config }) {
  const [report, setReport] = useWorkspaceField(["reports", "mode"], "heroes");
  const [selected, setSelected] = useWorkspaceField(
      ["reports", report === "heroes" ? "selectedDrafts" : "selectedGames"],
      [],
    ),
    [baseline, setBaseline] = useWorkspaceField(
      ["reports", "comparisonGames"],
      [],
    ),
    [title, setTitle] = useWorkspaceField(["reports", "titles", report], ""),
    [mvpSource, setMvpSource] = useWorkspaceField(
      ["reports", "mvpSource"],
      "recorded",
    ),
    [manualMvp, setManualMvp] = useWorkspaceField(["reports", "manualMvp"], {}),
    [mvp, setMvp] = useWorkspaceField(["reports", "mvpPlayerId"], ""),
    [includeZero, setIncludeZero] = useWorkspaceField(
      ["reports", "includeZero"],
      true,
    ),
    [includePartial, setIncludePartial] = useWorkspaceField(
      ["reports", "includePartial"],
      false,
    );
  const [data, setData] = useState({ drafts: [], games: [] }),
    [notice, setNotice] = useState(""),
    [ready, setReady] = useState(false),
    [rendered, setRendered] = useState("");
  const canvas = useRef(null);
  const refresh = () => workspaceRequest("analytics").then(setData);
  useEffect(() => {
    if (!active) return;
    let alive = true;
    workspaceRequest("analytics")
      .then((x) => {
        if (alive) setData(x);
      })
      .catch((e) => {
        if (alive) setNotice(e.message);
      });
    return () => {
      alive = false;
    };
  }, [active]);
  const drafts = useMemo(() => data.drafts.filter((d) => !d.excluded), [data]);
  const games = useMemo(
    () =>
      data.games.filter(
        (g) =>
          (report === "mvp"
            ? g.ended
            : includePartial || (g.ended && g.fromStart)) &&
          !["rehearsal", "replay"].includes(g.mode),
      ),
    [data, includePartial, report],
  );
  const chosenDrafts = useMemo(
    () => drafts.filter((d) => selected.includes(d.id)),
    [drafts, selected],
  );
  const chosenGames = useMemo(
    () => games.filter((d) => selected.includes(d.id)),
    [games, selected],
  );
  const baseGames = useMemo(
    () => data.games.filter((g) => baseline.includes(g.id)),
    [data, baseline],
  );
  const unresolved = chosenGames.flatMap((g) =>
    (g.purchases || [])
      .filter((p) => p.status === "review" || p.status === "pending")
      .map((p) => ({ ...p, gameId: g.id })),
  );
  const players = useMemo(() => {
    const map = new Map();
    for (const game of chosenGames)
      for (const p of game.players || []) {
        const old = map.get(p.id) || {
          id: p.id,
          name: p.name,
          heroId: p.heroId,
          kills: 0,
          deaths: 0,
          assists: 0,
          damage: 0,
          souls: 0,
          games: 0,
        };
        for (const k of ["kills", "deaths", "assists", "damage", "souls"])
          old[k] =
            Number.isFinite(p[k]) && old[k] !== null ? old[k] + p[k] : null;
        old.games++;
        map.set(p.id, old);
      }
    return [...map.values()]
      .sort((a, b) => (b.damage ?? -1) - (a.damage ?? -1))
      .map((p) => ({
        ...p,
        image: heroes.find((h) => h.id === p.heroId)?.gloatImage,
      }));
  }, [chosenGames]);
  const rows = useMemo(
    () =>
      report === "heroes"
        ? draftPriority(chosenDrafts, heroes).filter(
            (r) => includeZero || r.total,
          )
        : itemPriority(chosenGames, items, baseGames),
    [report, chosenDrafts, chosenGames, includeZero, baseGames],
  );
  const chartKey = JSON.stringify({
    manualMvp,
    mvpSource,
    report,
    title,
    rows,
    players,
    mvp,
    drafts: chosenDrafts.length,
    games: chosenGames.length,
    baseline: baseGames.length,
  });
  useEffect(() => {
    if (!active || !canvas.current) return;
    let alive = true;
    const target = document.createElement("canvas");
    const task =
      report === "heroes"
        ? drawHeroReport(target, { rows, title, games: chosenDrafts.length })
        : report === "items"
          ? drawItemReport(target, {
              rows,
              title,
              games: chosenGames.length,
              baselineGames: baseGames.length,
            })
          : drawMvpReport(target, {
              player:
                mvpSource === "manual"
                  ? manualMvp
                  : players.find((p) => p.id === mvp),
              title,
              games: chosenGames.length,
            });
    task
      .then(() => {
        if (alive && canvas.current) {
          canvas.current.width = target.width;
          canvas.current.height = target.height;
          canvas.current.getContext("2d").drawImage(target, 0, 0);
          setReady(true);
          setRendered(chartKey);
        }
      })
      .catch((e) => {
        if (alive) {
          setReady(false);
          setNotice(e.message);
        }
      });
    return () => {
      alive = false;
    };
  }, [
    active,
    report,
    rows,
    title,
    chosenDrafts.length,
    chosenGames.length,
    baseGames.length,
    players,
    mvp,
    chartKey,
    mvpSource,
    manualMvp,
  ]);
  const toggle = (id, setter) =>
    setter((old) =>
      old.includes(id) ? old.filter((x) => x !== id) : [...old, id],
    );
  async function action(path, value) {
    try {
      await workspaceRequest(path, value);
      await refresh();
      setNotice("Saved.");
    } catch (e) {
      setNotice(e.message);
    }
  }
  const manual = report === "mvp" && mvpSource === "manual";
  const manualReady =
    manualMvp.name?.trim() && heroes.some((h) => h.id === manualMvp.heroId);
  const list = report === "heroes" ? drafts : games;
  const blocked = report === "items" && unresolved.length > 0;
  return (
    <section className="analytics-studio" hidden={!active}>
      <div className="page-heading">
        <div>
          <span className="eyebrow">EVERY PICK / EVERY PURCHASE</span>
          <h1>
            Tournament reports<span>✦</span>
          </h1>
          <p>
            Choose saved drafts or games, then export a broadcast-ready image.
          </p>
        </div>
        <button
          className="button secondary"
          onClick={() => refresh().catch((e) => setNotice(e.message))}
        >
          Refresh archives
        </button>
      </div>
      <div className="production-tabs">
        {[
          ["heroes", "Hero priority"],
          ["items", "Top items"],
          ["mvp", "Series MVP"],
        ].map(([id, label]) => (
          <button
            key={id}
            className={report === id ? "selected" : ""}
            onClick={() => {
              setReport(id);
              setNotice("");
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {report === "mvp" && (
        <label className="production-card mvp-source">
          MVP data source
          <select
            value={mvpSource}
            onChange={(e) => setMvpSource(e.target.value)}
          >
            <option value="recorded">Saved match data</option>
            <option value="manual">Enter manually</option>
          </select>
        </label>
      )}
      <div className={`analytics-layout ${manual ? "manual-mvp-layout" : ""}`}>
        <aside className="production-card analytics-selection" hidden={manual}>
          <h2>Select {report === "heroes" ? "drafts" : "games"}</h2>
          <p>Only data from the current tournament is listed.</p>
          {report === "heroes" ? (
            <>
              <button
                className="button secondary"
                onClick={() =>
                  action("analytics/draft", {
                    label: `${config.round} · Game ${config.game}`,
                  })
                }
              >
                Save current draft now
              </button>
              <button
                className="button secondary"
                onClick={() =>
                  action("draft/connect", { mode: "manual", newDraft: true })
                }
              >
                Start next manual draft
              </button>
              <p>
                Live and manual drafts are saved as selections arrive.
                Reconnecting a live code updates the same archive. Starting the
                next manual draft clears the board and keeps its archive.
              </p>
            </>
          ) : (
            report === "items" && (
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={includePartial}
                  onChange={(e) => setIncludePartial(e.target.checked)}
                />
                Include incomplete or mid-game recordings
              </label>
            )
          )}
          <div className="analytics-select-actions">
            <button
              className="text-button"
              onClick={() => setSelected(list.map((d) => d.id))}
            >
              Select all
            </button>
            <button className="text-button" onClick={() => setSelected([])}>
              Clear
            </button>
          </div>
          {!list.length && (
            <p>
              No {report === "heroes" ? "drafts saved" : "eligible games saved"}{" "}
              yet.
            </p>
          )}
          <div className="archive-list">
            {list.map((d) => (
              <label key={d.id} className="archive-choice">
                <input
                  type="checkbox"
                  checked={selected.includes(d.id)}
                  onChange={() => toggle(d.id, setSelected)}
                />
                <span>
                  <strong>{d.label || d.code || d.id}</strong>
                  <small>
                    {d.tournament} ·{" "}
                    {report === "heroes"
                      ? `${d.selections.filter((s) => s.heroId).length} selections${d.completed ? " · complete" : ""}`
                      : `${d.purchases?.filter((p) => p.status === "confirmed").length || 0} confirmed purchases${!d.ended ? " · incomplete" : ""}${!d.fromStart ? " · partial capture" : ""}`}
                  </small>
                </span>
              </label>
            ))}
          </div>
          {report === "items" && (
            <details>
              <summary>Comparison games (optional)</summary>
              {data.games
                .filter((g) => g.ended && g.fromStart && g.mode !== "rehearsal")
                .map((g) => (
                  <label key={g.id} className="archive-choice">
                    <input
                      type="checkbox"
                      checked={baseline.includes(g.id)}
                      onChange={() => toggle(g.id, setBaseline)}
                    />
                    {g.label || g.id}
                  </label>
                ))}
            </details>
          )}
          <a href="/api/backup" className="button secondary" download>
            Download full backup ↓
          </a>
        </aside>
        <div className="analytics-result">
          <div className="report-studio-url">
            <strong>
              {report === "heroes"
                ? "Hero priority"
                : report === "items"
                  ? "Top items"
                  : "Series MVP"}{" "}
              · permanent OBS URL
            </strong>
            <input
              readOnly
              aria-label="Report OBS URL"
              value={`${window.location.origin}/obs/${{ heroes: "hero-priority", items: "top-items", mvp: "series-mvp" }[report]}`}
              onFocus={(e) => e.target.select()}
            />
            <a
              className="button secondary"
              target="_blank"
              rel="noreferrer"
              href={`/obs/${{ heroes: "hero-priority", items: "top-items", mvp: "series-mvp" }[report]}`}
            >
              Open OBS output ↗
            </a>
            <small>
              Follows the selected drafts or games and shared report settings.
            </small>
          </div>
          <div className="production-card analytics-options">
            <label>
              Image title
              <input
                value={title}
                placeholder={
                  report === "heroes"
                    ? "Hero priority"
                    : report === "items"
                      ? "Top items"
                      : "Series MVP"
                }
                onChange={(e) => setTitle(e.target.value)}
                maxLength={43}
              />
            </label>
            {report === "heroes" && (
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={includeZero}
                  onChange={(e) => setIncludeZero(e.target.checked)}
                />
                Include unused heroes
              </label>
            )}
            {manual && (
              <div className="manual-mvp-fields">
                <label>
                  Player name
                  <input
                    value={manualMvp.name || ""}
                    maxLength={48}
                    onChange={(e) =>
                      setManualMvp((old) => ({ ...old, name: e.target.value }))
                    }
                  />
                </label>
                <label>
                  Hero
                  <select
                    value={manualMvp.heroId || ""}
                    onChange={(e) =>
                      setManualMvp((old) => ({
                        ...old,
                        heroId: Number(e.target.value) || null,
                      }))
                    }
                  >
                    <option value="">Select a hero</option>
                    {heroes.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.name}
                      </option>
                    ))}
                  </select>
                </label>
                {["kills", "deaths", "assists", "damage", "souls"].map(
                  (key) => (
                    <label key={key}>
                      {key[0].toUpperCase() + key.slice(1)}
                      <input
                        type="number"
                        min="0"
                        max="9999999999"
                        step="1"
                        value={manualMvp[key] ?? ""}
                        onChange={(e) =>
                          setManualMvp((old) => ({
                            ...old,
                            [key]:
                              e.target.value === ""
                                ? null
                                : Number(e.target.value),
                          }))
                        }
                      />
                    </label>
                  ),
                )}
              </div>
            )}
            {report === "mvp" && !manual && (
              <label>
                MVP player
                <select value={mvp} onChange={(e) => setMvp(e.target.value)}>
                  <option value="">Select a player</option>
                  {players.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {p.games} games
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button
              className="button primary"
              disabled={
                !ready ||
                rendered !== chartKey ||
                blocked ||
                (manual
                  ? !manualReady
                  : !selected.length || (report === "mvp" && !mvp))
              }
              onClick={() =>
                downloadCanvas(canvas.current, `deadlock-ar-${report}`)
              }
            >
              Export PNG ↓
            </button>
            {manual && (
              <p className="manual-mvp-note">
                Manual values are saved for this tournament and update the
                Series MVP OBS source. No saved match is required.
              </p>
            )}
            {report === "mvp" && !manual && (
              <button
                className="button secondary"
                disabled={!mvp || !chosenGames.length}
                onClick={() =>
                  action("analytics/mvp", {
                    ids: chosenGames.map((g) => g.id),
                    playerId: mvp,
                    title: title || config.event,
                  })
                }
              >
                Confirm series MVP
              </button>
            )}
          </div>
          {notice && (
            <p className="production-notice" role="status">
              {notice}
            </p>
          )}
          {blocked && (
            <section className="production-card purchase-review">
              <h2>
                Resolve {unresolved.length} purchase
                {unresolved.length === 1 ? "" : "s"} before exporting
              </h2>
              <p>
                The recording did not establish whether these were full refunds
                or retained purchases.
              </p>
              {unresolved.map((p) => (
                <div key={`${p.gameId}:${p.id}`}>
                  <span>
                    {p.playerName} ·{" "}
                    {items.find((i) => i.id === p.itemId)?.name || p.itemId}
                    <small>{p.evidence}</small>
                  </span>
                  <button
                    onClick={() =>
                      action("analytics/review", {
                        gameId: p.gameId,
                        purchaseId: p.id,
                        status: "refunded",
                      })
                    }
                  >
                    Full refund
                  </button>
                  <button
                    onClick={() =>
                      action("analytics/review", {
                        gameId: p.gameId,
                        purchaseId: p.id,
                        status: "confirmed",
                      })
                    }
                  >
                    Count purchase
                  </button>
                </div>
              ))}
            </section>
          )}
          {report === "items" && includePartial && (
            <p className="production-notice">
              Partial captures omit purchases made before recording began. Their
              averages use only the selected recorded games.
            </p>
          )}
          <div className="report-preview">
            <canvas ref={canvas} aria-label="Report image preview" />
          </div>
          {report === "mvp" && (
            <p className="report-note">
              The series MVP uses its own OBS URL and the same on-fire portrait
              as this preview.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

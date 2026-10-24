import { useEffect, useRef, useState } from "react";
import heroes from "./heroes.json";
import ultimateCatalog from "../collector/data/ultimates.json";
import {
  collectorOverlayUrl,
  collectorRequest,
  liveRoster,
  visibleUltimateBadges,
  COLLECTOR_ORIGIN,
} from "./collector";
import { useCollector, useCollectorHealth } from "./use-collector";
import {
  cleanPanel,
  clock,
  displayNumber,
  parseMatchId,
  METRICS,
} from "./stats";
import { StatGraphic } from "./StatPanels";
import "./ProductionStudio.css";
import { useWorkspace, useWorkspaceField } from "./workspace-context.js";
import { diffFields } from "./workspace-model.js";
import { cleanSettings } from "../collector/model.mjs";
import ObserverControls from "./ObserverControls.jsx";
import PanelControls from "./PanelControls.jsx";
import MatchScoreboard from "./MatchScoreboard.jsx";

const roster = {
  ...Object.fromEntries(
    ultimateCatalog.map((h) => [
      h.heroId,
      { name: h.heroName, image: h.heroImage },
    ]),
  ),
  ...Object.fromEntries(heroes.map((h) => [h.id, h])),
};
function Portrait({ player }) {
  const hero = roster[player.heroId];
  return hero ? (
    <img src={hero.image} alt={hero.name} />
  ) : (
    <span className="production-unknown" title={`Hero ${player.heroId}`}>
      ✦
    </span>
  );
}
export function Hud({
  session,
  catalog = [],
  calibration = false,
  delayed = false,
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 80);
    return () => clearInterval(timer);
  }, []);
  const settings = session?.settings?.hud || {
    x: 460,
    y: 22,
    size: 62,
    gap: 12,
    teamGap: 145,
  };
  const players = liveRoster(session);
  const badges = visibleUltimateBadges(
    session,
    now - (delayed ? session?.settings?.delayMs || 0 : 0),
  );
  return (
    <div
      className="production-canvas ultimate-hud"
      aria-label="Ultimate hit HUD"
    >
      {[0, 1].flatMap((team) =>
        players
          .filter((p) => p.team === team)
          .map((p, i) => (
            <div
              key={p.id}
              className={`hud-player ${calibration ? "hud-calibration" : ""}`}
              style={{
                left:
                  settings.x +
                  (team * 6 + i) * (settings.size + settings.gap) +
                  team * settings.teamGap,
                top: settings.y,
                width: settings.size,
                height: settings.size,
              }}
            >
              {calibration && (
                <>
                  <Portrait player={p} />
                  <span className="hud-anchor-name">
                    {session.settings.names[p.id] || p.name}
                  </span>
                </>
              )}
              <div className="hud-badges">
                {badges
                  .filter((b) => b.targetId === p.id)
                  .slice(0, 4)
                  .map((b) => {
                    const ability = catalog.find((a) => a.id === b.abilityId);
                    return (
                      <span
                        key={b.abilityId}
                        className={`hud-ultimate ${b.kind}`}
                        title={`${ability?.heroName || "Hero"} · ${ability?.name || "Ultimate"} · ${b.kind === "effect" ? "effect active" : "hit"}`}
                        aria-label={`${ability?.name || "Ultimate"} ${b.kind} on ${p.name}`}
                      >
                        {ability?.image ? (
                          <img src={ability.image} alt={ability.name} />
                        ) : (
                          "ULT"
                        )}
                      </span>
                    );
                  })}
              </div>
              {session?.status === "live" &&
                now -
                  (delayed ? session.settings?.delayMs || 0 : 0) -
                  session.updatedAt <
                  10000 && (
                  <>
                    {p.buffs !== null && p.buffs !== undefined && (
                      <span
                        className="hud-permanent"
                        title={`Permanent buffs: ${p.buffs}`}
                        aria-label={`${p.name}: ${p.buffs} permanent buffs`}
                      >
                        {p.buffs}
                      </span>
                    )}
                    <div className="hud-bridges">
                      {(p.bridgeBuffs || []).map((b) => (
                        <span
                          key={b.id}
                          className={`hud-bridge ${b.label}`}
                          title={`${b.label} bridge buff${b.remaining !== null ? ` · ${Math.ceil(b.remaining)}s at source` : ""}`}
                        >
                          {b.label[0]}
                        </span>
                      ))}
                    </div>
                  </>
                )}
            </div>
          )),
      )}
    </div>
  );
}
export function Scoreboard({ result }) {
  return <MatchScoreboard result={result} />;
}
export function SeriesMvp({ result }) {
  if (!result) return null;
  const p = result.player,
    hero = roster[p.heroId];
  return (
    <div className="production-canvas mvp-canvas">
      <section className="mvp-card">
        <header>
          <img src="/logo.png" alt="Deadlock AR" />
          <span>{result.title}</span>
          <strong>SERIES MVP</strong>
        </header>
        <div className="mvp-content">
          {hero && (
            <img
              className="mvp-portrait"
              src={hero.gloatImage || hero.image}
              alt={hero.name}
            />
          )}
          <div>
            <span className="eyebrow">MOST VALUABLE PLAYER</span>
            <h1 dir="auto">{p.name}</h1>
            <p>{result.games} games in this series</p>
            <div className="mvp-totals">
              <strong>
                {p.kills} / {p.deaths} / {p.assists}
                <small>KILLS / DEATHS / ASSISTS</small>
              </strong>
              <strong>
                {displayNumber(p.damage)}
                <small>HERO DAMAGE</small>
              </strong>
              <strong>
                {displayNumber(p.souls)}
                <small>SOULS</small>
              </strong>
            </div>
          </div>
        </div>
        <footer>DEADLOCK AR · COMMUNITY TOURNAMENTS</footer>
      </section>
    </div>
  );
}
function Preview({ children, label }) {
  const ref = useRef(null),
    [scale, setScale] = useState(0.5);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setScale(entry.contentRect.width / 1920),
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return (
    <div className="production-preview" aria-label={label} ref={ref}>
      <div style={{ transform: `scale(${scale})` }}>{children}</div>
    </div>
  );
}
function ObsLink({ view, id, metric, label }) {
  const [notice, setNotice] = useState("");
  const url = collectorOverlayUrl(view, id, metric);
  return (
    <div className="production-obs-link">
      <div>
        <strong>{label}</strong>
        <input
          aria-label={`${label} OBS URL`}
          readOnly
          value={url}
          onFocus={(e) => e.target.select()}
        />
      </div>
      <button
        className="button secondary"
        onClick={() =>
          navigator.clipboard
            .writeText(url)
            .then(() => setNotice("Copied"))
            .catch(() => setNotice("Select the link to copy"))
        }
      >
        {notice || "Copy OBS URL"}
      </button>
      <a
        className="button secondary"
        href={url}
        target="_blank"
        rel="noreferrer"
      >
        Open ↗
      </a>
    </div>
  );
}
export default function ProductionStudio({ active, config }) {
  const shared = useWorkspace();
  const [panel, setPanel] = useWorkspaceField(
    ["deadem", "panel"],
    cleanPanel({ theme: "ink" }),
  );
  const [mvpId, setMvpId] = useState("");
  const [id, setId] = useWorkspaceField(["deadem", "id"], ""),
    [mode, setMode] = useState("live"),
    [section, setSection] = useState("panels"),
    [metric, setMetric] = useWorkspaceField(
      ["deadem", "panel", "metric"],
      "damage",
    ),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [winner, setWinner] = useState("");
  const { health, error: healthError } = useCollectorHealth(active);
  const { session, error } = useCollector(id, active);
  const rawMatch = session?.result?.match || session?.match;
  const match = rawMatch ? { ...rawMatch, heroInfo: roster } : null;
  const catalog = health?.catalog || [];
  const action = async (path, value = {}) => {
    setBusy(true);
    setNotice("");
    try {
      const payload =
        shared && path === "settings" && session
          ? {
              operations: diffFields(
                session.settings,
                cleanSettings(value, session.settings),
              ),
            }
          : value;
      const state = await collectorRequest(path, id, payload);
      if (state.id && !shared) setId(state.id);
      setNotice(
        path === "publish"
          ? "Scoreboard published. OBS now shows this reviewed snapshot."
          : path === "verify"
            ? "Finished metadata verified. Review and publish again to update the on-air scoreboard."
            : "Saved.",
      );
    } catch (e) {
      setNotice(e.message);
    } finally {
      setBusy(false);
    }
  };
  const start = (e) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    try {
      const next = parseMatchId(form.get("id"));
      action("start", {
        id: next,
        mode,
        broadcastUrl: form.get("broadcastUrl"),
        replaySpeed: Number(form.get("speed")),
        replayFrom: Number(form.get("from")) * 60,
      });
    } catch (e) {
      setNotice(e.message);
    }
  };
  const previewResult = session?.result
    ? {
        ...session.result,
        mvpId:
          mvpId || session.published?.mvpId || session.result.mvpId || null,
        winner: winner === "" ? session.result.winner : Number(winner),
        teams: config.teams,
        event: config.event,
        round: config.round,
        format: config.format,
        game: config.game,
        names: session.settings.names,
      }
    : null;
  return (
    <section className="production-studio" hidden={!active}>
      <div className="page-heading">
        <div>
          <span className="eyebrow">FROM FIRST FIGHT TO FINAL SCORE</span>
          <h1>
            Live desk<span>✦</span>
          </h1>
          <p>
            Custom collector: live stats, permanent buffs, ultimate indicators
            and saved results. API stats offers an alternative feed for similar
            panels.
          </p>
        </div>
        <span className={`collector-badge ${health ? "online" : ""}`}>
          <i />
          {health ? "Collector connected" : "Collector offline"}
        </span>
      </div>
      {!health && (
        <div className="collector-setup">
          <h2>
            {shared
              ? "Connecting to the cloud collector"
              : "Run your broadcast companion"}
          </h2>
          <p>
            {shared ? (
              "The studio runs on Railway. Run the observer companion on the PC recording the game."
            ) : (
              <>
                Open <strong>Start-Collector.cmd</strong> on the broadcast PC
                and keep it running.
              </>
            )}
          </p>
          {!shared && (
            <a
              className="button primary"
              href={`${COLLECTOR_ORIGIN}/?tab=live`}
              target="_blank"
              rel="noreferrer"
            >
              Open local Live desk ↗
            </a>
          )}
          <p>{healthError}</p>
        </div>
      )}
      {shared && <ObserverControls active={active} />}
      <details className="relay-fallback">
        <summary>Delayed relay / replay fallback</summary>
        <section className="production-card collector-connect">
          <div>
            <span className="eyebrow">GAME CONNECTION</span>
            <h2>Bring the match into the studio.</h2>
            <p>
              {health?.running
                ? `Collecting match ${health.activeId}`
                : "Enter the match ID, or rehearse with a finished replay."}
            </p>
          </div>
          <form onSubmit={start}>
            <label>
              Match ID
              <input
                name="id"
                placeholder="120901644"
                inputMode="numeric"
                required
              />
            </label>
            <label>
              Source
              <select value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="live">Valve relay (delayed)</option>
                <option value="replay">Replay rehearsal</option>
              </select>
            </label>
            {mode === "replay" && (
              <>
                <label>
                  Speed
                  <select name="speed" defaultValue="16">
                    <option value="1">1×</option>
                    <option value="4">4×</option>
                    <option value="16">16×</option>
                    <option value="32">32×</option>
                  </select>
                </label>
                <label>
                  Start at (minutes)
                  <input
                    type="number"
                    name="from"
                    min="0"
                    max="120"
                    defaultValue="5"
                  />
                </label>
              </>
            )}
            <button
              className="button primary"
              disabled={!health || busy || health.running}
            >
              Start collector
            </button>
            {health?.running && (
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => action("stop")}
              >
                Stop
              </button>
            )}
            <details>
              <summary>Have the Valve broadcast URL?</summary>
              <input
                name="broadcastUrl"
                placeholder="http://dist1-ord1.steamcontent.com/tv/MATCH_ID_TOKEN"
              />
            </details>
          </form>
        </section>
      </details>
      <div className="production-toolbar">
        <label>
          Saved games
          <select
            value={id}
            onChange={(e) => {
              setId(e.target.value);
              setWinner("");
              setMvpId("");
            }}
          >
            <option value="">Choose a game</option>
            {health?.games.map((g) => (
              <option key={g.id} value={g.id}>
                {g.id} · {g.mode === "replay" ? "rehearsal" : g.status}
                {g.published ? " · published" : ""}
              </option>
            ))}
          </select>
        </label>
        {session && (
          <span className={`production-feed ${session.status}`}>
            {session.mode === "replay" && <b>REPLAY · </b>}
            {session.message}
            {match?.duration != null ? ` · ${clock(match.duration)}` : ""}
          </span>
        )}
      </div>
      {(notice || error) && (
        <p className="production-notice" role="status">
          {notice || error}
        </p>
      )}
      {session?.storageError && (
        <p className="production-notice" role="alert">
          Storage write failed. Keep this studio open and download a backup from
          OBS outputs before restarting the service.
        </p>
      )}
      {session && (
        <>
          <div className="production-tabs">
            {[
              ["panels", "Live stat panels"],
              ["hud", "Ultimate HUD"],
              ["scoreboard", "Post-match scoreboard"],
            ].map(([key, label]) => (
              <button
                key={key}
                className={section === key ? "selected" : ""}
                onClick={() => setSection(key)}
              >
                {label}
              </button>
            ))}
          </div>
          {section === "panels" && (
            <>
              <div className="production-section-heading">
                <div>
                  <h2>Small panels. Clear numbers.</h2>
                  <p>All twelve players, with permanent pickups included.</p>
                </div>
                <label>
                  Statistic
                  <select
                    value={metric}
                    onChange={(e) => setMetric(e.target.value)}
                  >
                    {Object.entries(METRICS).map(([key, v]) => (
                      <option key={key} value={key}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {shared && (
                <button
                  className="button secondary"
                  onClick={() =>
                    shared.update(["deadem", "visible"], (v) => !v)
                  }
                >
                  {shared.data.deadem.visible
                    ? "Hide stats on stream"
                    : "Show stats on stream"}
                </button>
              )}
              <Preview label="Deadem stat panel preview">
                <StatGraphic
                  match={match}
                  panel={cleanPanel({
                    ...panel,
                    metric,
                    names: session.settings.names,
                    teamNames: config.teams.map((t) => t.name),
                  })}
                  time={match?.duration}
                  status={
                    session.status === "finished"
                      ? "finished"
                      : session.status === "live"
                        ? "live"
                        : ["connecting", "reconnecting"].includes(
                              session.status,
                            )
                          ? "loading"
                          : "error"
                  }
                  stale={
                    session.status !== "live" && session.status !== "finished"
                  }
                />
              </Preview>
              <PanelControls panel={cleanPanel(panel)} setPanel={setPanel} />
              <ObsLink
                id={id}
                metric={metric}
                view="collector-panel"
                label="Live stats panel"
              />
            </>
          )}
          {section === "hud" && (
            <>
              {shared && (
                <button
                  className="button secondary"
                  onClick={() =>
                    shared.update(["deadem", "hudVisible"], (v) => !v)
                  }
                >
                  {shared.data.deadem.hudVisible
                    ? "Hide HUD on stream"
                    : "Show HUD on stream"}
                </button>
              )}
              <div className="production-section-heading">
                <div>
                  <h2>Make every ultimate readable.</h2>
                  <p>
                    Align these reference portraits with the game's HUD. The OBS
                    source shows only ultimate badges.
                  </p>
                </div>
                <span className="production-pill">1920 × 1080</span>
              </div>
              <Preview label="Ultimate HUD calibration preview">
                <Hud session={session} catalog={catalog} calibration />
              </Preview>
              <section className="production-card">
                <form
                  className="production-calibration"
                  key={`${id}:${JSON.stringify(session.settings.hud)}:${session.settings.delayMs}`}
                  onSubmit={(e) => {
                    e.preventDefault();
                    const values = Object.fromEntries(
                      new FormData(e.currentTarget),
                    );
                    action("settings", {
                      hud: values,
                      delayMs: Number(values.delay) * 1000,
                    });
                  }}
                >
                  {[
                    ["x", "Left position", 0, 1850],
                    ["y", "Top position", 0, 1000],
                    ["size", "Portrait size", 24, 90],
                    ["gap", "Portrait gap", 0, 80],
                    ["teamGap", "Team gap", 0, 500],
                  ].map(([key, label, min, max]) => (
                    <label key={key}>
                      {label}
                      <input
                        name={key}
                        type="number"
                        min={min}
                        max={max}
                        defaultValue={session.settings.hud[key]}
                      />
                    </label>
                  ))}
                  <label>
                    Additional graphics delay (seconds)
                    <input
                      name="delay"
                      type="number"
                      min="0"
                      max="120"
                      step="0.1"
                      defaultValue={session.settings.delayMs / 1000}
                    />
                  </label>
                  <button className="button primary" disabled={busy}>
                    Apply calibration
                  </button>
                </form>
                <p>
                  This setting delays graphics in the collector OBS views. If
                  the game video arrives before the data, delay the video in
                  OBS. Short hit badges fade after 1.6 seconds; validated effect
                  badges disappear when the effect is removed.
                </p>
                <details className="hud-order-controls">
                  <summary>Match portrait order to the game</summary>
                  <p>
                    Move each hero left or right within its team until the
                    reference portraits match the game HUD.
                  </p>
                  <div>
                    {[0, 1].map((team) => {
                      const teamPlayers = liveRoster(session).filter(
                        (p) => p.team === team,
                      );
                      return (
                        <section key={team}>
                          <strong>{config.teams[team].name}</strong>
                          {teamPlayers.map((p, i) => (
                            <div key={p.id}>
                              <Portrait player={p} />
                              <span>{roster[p.heroId]?.name || p.name}</span>
                              {[-1, 1].map((direction) => (
                                <button
                                  type="button"
                                  className="button secondary"
                                  key={direction}
                                  disabled={
                                    busy ||
                                    i + direction < 0 ||
                                    i + direction >= teamPlayers.length
                                  }
                                  aria-label={`Move ${roster[p.heroId]?.name || p.name} ${direction < 0 ? "left" : "right"}`}
                                  onClick={() => {
                                    const all = liveRoster(session);
                                    const from = all.findIndex(
                                        (v) => v.id === p.id,
                                      ),
                                      to = from + direction;
                                    [all[from], all[to]] = [all[to], all[from]];
                                    action("settings", {
                                      hudOrder: all.map((v) => v.id),
                                    });
                                  }}
                                >
                                  {direction < 0 ? "←" : "→"}
                                </button>
                              ))}
                            </div>
                          ))}
                        </section>
                      );
                    })}
                  </div>
                </details>
              </section>
              <ObsLink id={id} view="ultimate-hud" label="Ultimate hit HUD" />
              <details className="production-coverage">
                <summary>Ultimate detection coverage</summary>
                <p>
                  Damage hits use ability IDs as candidates. Graves summon hits
                  are suppressed because a second-ability zombie can report the
                  ultimate ID. Self buffs and utility ultimates do not produce
                  enemy-hit badges. Lasting effects are enabled for the four
                  replay-verified abilities below; other effects need
                  per-ability validation.
                </p>
                <div>
                  {catalog.map((a) => (
                    <span key={a.id}>
                      <strong>
                        {a.heroName} · {a.name}
                      </strong>
                      <small>{a.detection}</small>
                    </span>
                  ))}
                </div>
              </details>
            </>
          )}
          {section === "scoreboard" && (
            <>
              {shared && (
                <button
                  className="button secondary"
                  onClick={() =>
                    shared.update(["scoreboard", "visible"], (v) => !v)
                  }
                >
                  {shared.data.scoreboard.visible
                    ? "Hide scoreboard on stream"
                    : "Show scoreboard on stream"}
                </button>
              )}
              <div className="production-section-heading">
                <div>
                  <h2>Ready when the game ends.</h2>
                  <p>
                    {session.result
                      ? "Captured stats are saved. Check the teams, series score, winner, and names before publishing."
                      : "Waiting for an actual game-over signal. A stopped feed is never treated as a finished game."}
                  </p>
                </div>
              </div>
              {previewResult ? (
                <>
                  <div className="production-review">
                    <label>
                      Winning team
                      <select
                        value={
                          winner === ""
                            ? String(session.result.winner ?? "")
                            : winner
                        }
                        onChange={(e) => setWinner(e.target.value)}
                      >
                        <option value="">Confirm winner</option>
                        {config.teams.map((t, i) => (
                          <option value={i} key={i}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Game MVP (optional override)
                      <select
                        value={
                          mvpId ||
                          session.published?.mvpId ||
                          session.result.mvpId ||
                          ""
                        }
                        onChange={(e) => setMvpId(e.target.value)}
                      >
                        <option value="">No MVP confirmed</option>
                        {session.result.match.players.map((p) => (
                          <option key={p.id} value={p.id}>
                            {session.settings.names[p.id] || p.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <span className="production-pill">
                      {session.result.verification === "metadata"
                        ? "Metadata verified"
                        : "Broadcast capture · review required"}
                    </span>
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={() => action("verify")}
                    >
                      Verify with finished metadata
                    </button>
                    <button
                      className="button primary"
                      disabled={
                        busy ||
                        (winner === "" && session.result.winner === null)
                      }
                      onClick={() =>
                        action("publish", {
                          ...config,
                          mvpId: mvpId || session.published?.mvpId || null,
                          winner:
                            winner === ""
                              ? session.result.winner
                              : Number(winner),
                        })
                      }
                    >
                      {session.published
                        ? "Publish updated scoreboard"
                        : "Publish reviewed scoreboard"}
                    </button>
                  </div>
                  <Preview label="Post-match scoreboard review preview">
                    <Scoreboard result={previewResult} />
                  </Preview>
                  <p className="production-hint">
                    Team names, logos, game number, and series score come from
                    Broadcast settings. Publishing freezes this version for OBS.
                    Verification and later edits only appear on air after you
                    publish again.
                  </p>
                  {session.published && (
                    <ObsLink
                      id={id}
                      view="scoreboard"
                      label="Published post-match scoreboard"
                    />
                  )}
                </>
              ) : (
                <div className="production-empty">
                  The scoreboard will be prepared automatically when this game
                  ends. Your last received stats remain saved if the connection
                  is interrupted.
                </div>
              )}
            </>
          )}
          {match?.players.length > 0 && (
            <details className="production-names">
              <summary>Player display names</summary>
              <div>
                {match.players.map((p) => (
                  <label key={p.id}>
                    <Portrait player={p} />
                    <span>{roster[p.heroId]?.name || `Hero ${p.heroId}`}</span>
                    <input
                      key={`${p.id}:${session.settings.names[p.id] || p.name}`}
                      defaultValue={session.settings.names[p.id] || p.name}
                      maxLength="48"
                      aria-label={`Display name for ${p.name}`}
                      onBlur={(e) => {
                        if (
                          e.target.value !==
                          (session.settings.names[p.id] || p.name)
                        )
                          action("settings", {
                            names: {
                              ...session.settings.names,
                              [p.id]: e.target.value,
                            },
                          });
                      }}
                    />
                  </label>
                ))}
              </div>
            </details>
          )}
        </>
      )}
    </section>
  );
}
export function ProductionOverlay() {
  const params = new URLSearchParams(window.location.search),
    id = params.get("match") || "",
    view = params.get("view");
  const { health } = useCollectorHealth();
  const { session, error } = useCollector(id, /^\d+$/.test(id), true);
  const frame = useRef(null),
    [scale, setScale] = useState(1),
    [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    document.documentElement.classList.add("production-broadcast-document");
    const observer = new ResizeObserver(([entry]) =>
      setScale(entry.contentRect.width / 1920),
    );
    if (frame.current) observer.observe(frame.current);
    return () => {
      observer.disconnect();
      document.documentElement.classList.remove(
        "production-broadcast-document",
      );
    };
  }, []);
  const rawMatch = session?.result?.match || session?.match;
  const match = rawMatch ? { ...rawMatch, heroInfo: roster } : null;
  const metric = Object.hasOwn(METRICS, params.get("metric"))
    ? params.get("metric")
    : "damage";
  return (
    <main className="production-overlay" ref={frame}>
      <div
        className="production-scaled"
        style={{ transform: `scale(${scale})` }}
      >
        {view === "ultimate-hud" ? (
          <Hud
            session={error ? null : session}
            catalog={health?.catalog}
            delayed
            calibration={params.get("calibrate") === "1"}
          />
        ) : view === "scoreboard" ? (
          <Scoreboard result={session?.published} />
        ) : match ? (
          <StatGraphic
            match={match}
            panel={cleanPanel({
              metric,
              theme: "ink",
              names: session.settings.names,
            })}
            time={match.duration}
            status={session.status === "finished" ? "finished" : "live"}
            stale={
              Boolean(error) ||
              (!session.result &&
                (now - session.updatedAt > 15000 || session.status !== "live"))
            }
          />
        ) : (
          <div className="production-canvas production-waiting">
            {error || "Waiting for the collector…"}
          </div>
        )}
      </div>
    </main>
  );
}

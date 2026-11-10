import { useEffect, useRef, useState } from "react";
import heroes from "./heroes.json";
import ultimateCatalog from "../collector/data/ultimates.json";
import {
  collectorOverlayUrl,
  collectorRequest,
  liveRoster,
  visibleUltimateBadges,
  collectorRenderNow,
  collectorFreshAt,
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
import CollectorPanel from "./CollectorPanel.jsx";
import "./ProductionStudio.css";
import { useWorkspace, useWorkspaceField } from "./workspace-context.js";
import { diffFields } from "./workspace-model.js";
import { cleanSettings } from "../collector/model.mjs";
import ObserverControls from "./ObserverControls.jsx";
import PanelControls from "./PanelControls.jsx";
import MatchScoreboard from "./MatchScoreboard.jsx";
import RecordingEvidence from "./RecordingEvidence.jsx";
import "./RecordingEvidence.css";
import StatWindowControls from "./StatWindowControls.jsx";
import CaptureDataStatus from "./CaptureDataStatus.jsx";

const roster = {
  ...Object.fromEntries(
    ultimateCatalog.map((h) => [
      h.heroId,
      { name: h.heroName, image: h.heroImage },
    ]),
  ),
  ...Object.fromEntries(heroes.map((h) => [h.id, h])),
};
const bridgeIcons = {
  Gun: "gun",
  Movement: "movement",
  Casting: "casting",
  Survival: "survival",
};
const defaultHudPlacement = { x: 460, y: 22, size: 62, gap: 12, teamGap: 145 };
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
  preview = null,
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 80);
    return () => clearInterval(timer);
  }, []);
  const settings =
    preview?.settings || session?.settings?.hud || defaultHudPlacement;
  const players = preview?.players || liveRoster(session);
  const sourceNow = collectorRenderNow(session, now, delayed);
  const badges = preview?.badges || visibleUltimateBadges(session, sourceNow);
  const bridgesFresh =
    Boolean(preview) ||
    (session?.status === "live" &&
      sourceNow - collectorFreshAt(session) < 10000);
  return (
    <div
      className="production-canvas ultimate-hud"
      aria-label="Ultimate hit HUD"
    >
      {[0, 1].flatMap((team) =>
        players
          .filter((p) => p.team === team)
          .map((p, i) => {
            const bridges =
              (preview ? preview.bridgeBuffs[p.id] : p.bridgeBuffs) || [];
            return (
              <div
                key={p.id}
                className={`hud-player ${calibration ? "hud-calibration" : ""}${bridgesFresh && bridges.length ? " hud-with-bridges" : ""}`}
                style={{
                  left:
                    settings.x +
                    (team * 6 + i) * (settings.size + settings.gap) +
                    team * settings.teamGap,
                  top: settings.y,
                  width: settings.size,
                  height: settings.size,
                  "--hud-ultimate-size": `${Math.min(32, settings.size * 0.5)}px`,
                  "--hud-bridge-size": `${Math.min(24, settings.size * 0.4)}px`,
                  "--hud-badge-outset": `${Math.min(4, settings.gap / 2)}px`,
                  "--hud-corner-overlap": `${Math.min(12, settings.size * 0.2)}px`,
                  "--hud-label-width": `${Math.max(1, settings.size + settings.gap - 4)}px`,
                }}
              >
                {calibration && (
                  <>
                    <Portrait player={p} />
                    <span
                      className="hud-anchor-name"
                      title={session?.settings?.names?.[p.id] || p.name}
                    >
                      {session?.settings?.names?.[p.id] || p.name}
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
                            "✦"
                          )}
                        </span>
                      );
                    })}
                </div>
                {bridgesFresh && (
                  <div className="hud-bridges">
                    {bridges
                      .filter((b) => bridgeIcons[b.label])
                      .slice(0, 4)
                      .map((b) => (
                        <span
                          key={b.id}
                          className={`hud-bridge ${b.label}`}
                          title={`${b.label} bridge buff${b.remaining !== null ? ` · ${Math.ceil(b.remaining)}s at source` : ""}`}
                          aria-label={`${b.label} bridge buff on ${p.name}`}
                        >
                          <img
                            src={`/bridge-buffs/${bridgeIcons[b.label]}.png`}
                            alt=""
                          />
                        </span>
                      ))}
                  </div>
                )}
              </div>
            );
          }),
      )}
    </div>
  );
}
function HudPlacementTester({ session, catalog }) {
  const [enabled, setEnabled] = useState(false);
  const [target, setTarget] = useState("all");
  const [kind, setKind] = useState("mixed");
  const [count, setCount] = useState(1);
  const [abilityId, setAbilityId] = useState("");
  const [buffs, setBuffs] = useState(Object.keys(bridgeIcons));
  const [placement, setPlacement] = useState(null);
  const available = catalog?.length ? catalog : ultimateCatalog;
  const current = liveRoster(session);
  const players = [0, 1].flatMap((team) => {
    const teamPlayers = current.filter((player) => player.team === team);
    return Array.from(
      { length: 6 },
      (_, slot) =>
        teamPlayers[slot] || {
          id: `hud-preview-${team}-${slot}`,
          team,
          slot,
          heroId: heroes[team * 6 + slot]?.id,
          name: `${team === 0 ? "Left" : "Right"} player ${slot + 1}`,
        },
    );
  });
  const selectedAbility =
    available.find((ability) => String(ability.id) === abilityId) ||
    available[0];
  const chosen = selectedAbility
    ? [
        selectedAbility,
        ...available.filter((ability) => ability.id !== selectedAbility.id),
      ].slice(0, count)
    : [];
  const targetIds =
    target === "all"
      ? players.map((player) => player.id)
      : [
          players.some((player) => player.id === target)
            ? target
            : players[0].id,
        ];
  const settings = placement || session?.settings?.hud || defaultHudPlacement;
  const preview = enabled
    ? {
        settings,
        players,
        badges: targetIds.flatMap((targetId) =>
          chosen.map((ability, index) => ({
            targetId,
            abilityId: ability.id,
            kind: kind === "mixed" ? (index % 2 ? "effect" : "hit") : kind,
          })),
        ),
        bridgeBuffs: Object.fromEntries(
          targetIds.map((id) => [
            id,
            buffs.map((label) => ({ id: label, label, remaining: null })),
          ]),
        ),
      }
    : null;
  return (
    <section className="production-card hud-placement-tester">
      <div className="hud-test-heading">
        <div>
          <h2>Ultimate HUD preview</h2>
          <p>
            Check ultimate interactions at the lower left and bridge buffs at
            the lower right of every portrait.
          </p>
        </div>
        <span className="production-pill">1920 × 1080</span>
      </div>
      <div className="hud-test-mode">
        <strong>{enabled ? "Local placement test" : "Live preview"}</strong>
        <span>
          Preview only · test indicators are never sent to OBS or match data.
        </span>
        <button
          type="button"
          className={`button ${enabled ? "secondary" : "primary"}`}
          onClick={() => setEnabled((value) => !value)}
        >
          {enabled ? "Clear test" : "Show test indicators"}
        </button>
      </div>
      <div className="hud-test-controls">
        <label>
          Target player
          <select
            aria-label="HUD test target"
            value={target}
            onChange={(event) => setTarget(event.target.value)}
          >
            <option value="all">All twelve positions</option>
            {players.map((player, index) => (
              <option value={player.id} key={player.id}>
                {index < 6 ? "Left" : "Right"} {(index % 6) + 1} ·{" "}
                {session?.settings?.names?.[player.id] || player.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Ultimate
          <select
            aria-label="HUD test ultimate"
            value={selectedAbility?.id || ""}
            onChange={(event) => setAbilityId(event.target.value)}
          >
            {available.map((ability) => (
              <option value={ability.id} key={ability.id}>
                {ability.heroName} · {ability.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Interaction
          <select
            aria-label="HUD test interaction"
            value={kind}
            onChange={(event) => setKind(event.target.value)}
          >
            <option value="hit">Damage hit</option>
            <option value="effect">Lasting effect</option>
            <option value="mixed">Hit and effect</option>
          </select>
        </label>
        <label>
          Badges per player
          <select
            aria-label="HUD test badge count"
            value={count}
            onChange={(event) => setCount(Number(event.target.value))}
          >
            {[1, 2, 3, 4].map((number) => (
              <option key={number} value={number}>
                {number}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div
        className="hud-test-buffs"
        role="group"
        aria-label="HUD test bridge buffs"
      >
        {Object.keys(bridgeIcons).map((label) => (
          <label key={label}>
            <input
              type="checkbox"
              checked={buffs.includes(label)}
              onChange={(event) =>
                setBuffs((currentBuffs) =>
                  event.target.checked
                    ? [...currentBuffs, label]
                    : currentBuffs.filter((buff) => buff !== label),
                )
              }
            />
            <img src={`/bridge-buffs/${bridgeIcons[label]}.png`} alt="" />
            {label}
          </label>
        ))}
        <button
          type="button"
          className="text-button"
          onClick={() => {
            setTarget("all");
            setCount(4);
            setKind("mixed");
            setBuffs(Object.keys(bridgeIcons));
            setEnabled(true);
          }}
        >
          Test all corners
        </button>
      </div>
      <details className="hud-test-placement">
        <summary>Adjust local test placement</summary>
        <p>
          These adjustments affect this preview. Use Apply calibration below to
          save the real HUD position when a game is selected.
        </p>
        <div className="hud-test-controls">
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
                type="number"
                aria-label={`HUD test ${label.toLowerCase()}`}
                min={min}
                max={max}
                value={settings[key]}
                onChange={(event) => {
                  const value = Math.max(
                    min,
                    Math.min(max, Number(event.target.value) || 0),
                  );
                  setPlacement({ ...settings, [key]: value });
                  setEnabled(true);
                }}
              />
            </label>
          ))}
        </div>
        <button
          type="button"
          className="text-button"
          onClick={() => setPlacement(null)}
        >
          Use current HUD placement
        </button>
      </details>
      {!session && !enabled && (
        <p className="production-hint">
          No game is selected. Show test indicators to check all twelve
          positions without a recording.
        </p>
      )}
      <Preview
        label={
          enabled
            ? "Local placement test · preview only"
            : "Ultimate HUD calibration preview"
        }
      >
        <Hud
          session={session}
          catalog={available}
          calibration
          preview={preview}
        />
      </Preview>
    </section>
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
function ObsLink({ view, id, metric, content, label }) {
  const [notice, setNotice] = useState("");
  const url = collectorOverlayUrl(view, id, metric, content);
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
  const [metricsNow, setMetricsNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setMetricsNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  const [panel, setPanel] = useWorkspaceField(
    ["deadem", "panel"],
    cleanPanel({ theme: "ink" }),
  );
  const [mvpId, setMvpId] = useState("");
  const [id, setId] = useWorkspaceField(["deadem", "id"], ""),
    [mode, setMode] = useState("live"),
    [section, setSection] = useState("panels"),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [winner, setWinner] = useState("");
  const { health, error: healthError } = useCollectorHealth(active);
  const { session, error } = useCollector(id, active);
  const rawMatch = session?.result?.match || session?.match;
  const match = rawMatch ? { ...rawMatch, heroInfo: roster } : null;
  const metric = panel.metric;
  const graphPanel = panel.content === "souls-graph";
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
        path === "publish-sources"
          ? "Recovered souls by source published with the scoreboard’s saved teams and scores."
          : path === "publish"
            ? "Scoreboard published. OBS now shows this reviewed snapshot."
            : path === "verify"
              ? "Finished metadata verified. Review and publish again to update the on-air scoreboard."
              : path === "repair"
                ? "Recording details repaired. Review and publish the updated scoreboard."
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
      {session && <RecordingEvidence session={session} />}
      {session && <CaptureDataStatus session={session} />}
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
      {section === "hud" && (
        <HudPlacementTester session={session} catalog={catalog} />
      )}
      {!session && section !== "hud" && (
        <p className="production-hint">
          Choose a saved game, or open Ultimate HUD to try the local placement
          test.
        </p>
      )}
      {session && (
        <>
          {section === "panels" && (
            <>
              <div className="production-section-heading">
                <div>
                  <h2>Small panels. Clear numbers.</h2>
                  <p>Choose player statistics or the souls difference graph.</p>
                </div>
                <label>
                  Panel
                  <select
                    aria-label="Live panel"
                    value={graphPanel ? "souls-graph" : metric}
                    onChange={(e) => {
                      const value = e.target.value;
                      setPanel((old) =>
                        cleanPanel({
                          ...old,
                          content:
                            value === "souls-graph" ? "souls-graph" : "players",
                          metric: value === "souls-graph" ? old.metric : value,
                        }),
                      );
                    }}
                  >
                    {Object.entries(METRICS).map(([key, v]) => (
                      <option key={key} value={key}>
                        {v.label}
                      </option>
                    ))}
                    <option value="souls-graph">Souls difference graph</option>
                  </select>
                </label>
              </div>
              {!graphPanel && (
                <StatWindowControls
                  key={id}
                  session={session}
                  busy={busy}
                  now={metricsNow}
                  onStart={(request) => action("stat-window", request)}
                  onTotals={() => action("settings", { metricsBaseline: null })}
                />
              )}
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
              <Preview
                label={
                  graphPanel
                    ? "Souls difference panel preview"
                    : "Live stat panel preview"
                }
              >
                <CollectorPanel
                  visible={shared?.data.deadem.visible !== false}
                  session={session}
                  panel={cleanPanel({
                    ...panel,
                    metric,
                    names: session.settings.names,
                    teamNames: config.teams.map((t) => t.name),
                  })}
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
                    !session.result &&
                    (session.status !== "live" ||
                      metricsNow - session.updatedAt > 15000)
                  }
                />
              </Preview>
              {graphPanel && (
                <p className="production-hint">
                  Shows the difference in team net worth across the recorded
                  match. The graph starts when collection starts and leaves gaps
                  where observations are missing.
                </p>
              )}
              <PanelControls panel={cleanPanel(panel)} setPanel={setPanel} />
              <ObsLink
                id={id}
                metric={metric}
                content={panel.content}
                view="collector-panel"
                label={
                  graphPanel ? "Souls difference panel" : "Live stats panel"
                }
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
                    Target graphics delay (seconds)
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
                  Updated observers buffer the recording timeline to this
                  target, smoothing data that arrives in bursts. Start with 5
                  seconds. Late data appears as soon as it arrives, so this
                  cannot guarantee an exact game-to-screen delay. Older
                  observers use an additional delay after receipt. If the game
                  video arrives first, delay the video in OBS too.
                </p>
                <p className="production-hint" role="status">
                  {session.sourceTiming?.basis === "recording-timeline"
                    ? `Recording timeline buffering available · target ${session.settings.delayMs / 1000}s. Last source update ${Math.max(0, session.sourceTiming.receivedAt - session.sourceTiming.sourceAt - session.settings.delayMs) > 100 ? `missed the target by ${(Math.max(0, session.sourceTiming.receivedAt - session.sourceTiming.sourceAt - session.settings.delayMs) / 1000).toFixed(1)}s` : "arrived within the target"}.`
                    : "This capture uses receipt timing. The updated observer enables timeline buffering on new recordings."}
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
                    {session.published &&
                      session.result.sourceBreakdown &&
                      (session.published.sourceBreakdown?.receivedAt || 0) <
                        session.result.sourceBreakdown.receivedAt && (
                        <button
                          className="button secondary"
                          disabled={busy}
                          onClick={() => action("publish-sources")}
                        >
                          Publish recovered sources
                        </button>
                      )}
                    {shared && (
                      <label className="button secondary">
                        Load repaired recording details
                        <input
                          type="file"
                          accept=".json,application/json"
                          aria-label="Load repaired recording details"
                          hidden
                          disabled={busy}
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            e.target.value = "";
                            if (!file) return;
                            try {
                              if (file.size > 2000000)
                                throw Error("Repair file is too large.");
                              await action(
                                "repair",
                                JSON.parse(await file.text()),
                              );
                            } catch (error) {
                              setNotice(error.message);
                            }
                          }}
                        />
                      </label>
                    )}
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
          <CollectorPanel
            session={session}
            panel={cleanPanel({
              metric,
              content: params.get("content"),
              theme: "ink",
              names: session.settings.names,
            })}
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

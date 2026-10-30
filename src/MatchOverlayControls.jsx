import { useEffect, useRef, useState } from "react";
import heroes from "./heroes.json";
import MatchOverlay from "./MatchOverlay.jsx";
import {
  cleanMatchOverlay,
  resolveMatchOverlay,
  matchOverlayWins,
  MATCH_OVERLAY_FONTS,
} from "./match-overlay.js";
import { useWorkspace, useWorkspaceField } from "./workspace-context.js";
import { useCollector } from "./use-collector.js";
import "./MatchOverlayControls.css";

const roster = Object.fromEntries(heroes.map((hero) => [hero.id, hero]));
const sortedHeroes = [...heroes].sort((a, b) => a.name.localeCompare(b.name));

function HeroPicker({ value, title, onSelect, onClose }) {
  const [search, setSearch] = useState("");
  const searchRef = useRef(null);
  useEffect(() => {
    const previousFocus = document.activeElement;
    searchRef.current?.focus();
    return () => previousFocus?.focus?.();
  }, []);
  const keyboard = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
    if (event.key !== "Tab") return;
    const elements = [
      ...event.currentTarget.querySelectorAll("button:not(:disabled), input"),
    ];
    const first = elements[0],
      last = elements.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };
  const filtered = sortedHeroes.filter((hero) =>
    hero.name.toLowerCase().includes(search.trim().toLowerCase()),
  );
  return (
    <div
      className="mo-picker-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="mo-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby="match-overlay-picker-title"
        onKeyDown={keyboard}
      >
        <div className="mo-picker-head">
          <h2 id="match-overlay-picker-title">{title}</h2>
          <button className="button secondary" onClick={onClose}>
            Close
          </button>
        </div>
        <label>
          Search all {heroes.length} heroes
          <input
            ref={searchRef}
            value={search}
            placeholder="Search by hero name"
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <div className="mo-hero-grid">
          <button
            className="mo-hero-option"
            aria-pressed={!value}
            onClick={() => onSelect(null)}
          >
            <span className="mo-clear-ban">—</span>
            <span>Empty slot</span>
          </button>
          {filtered.map((hero) => (
            <button
              key={hero.id}
              className="mo-hero-option"
              aria-pressed={hero.id === value}
              onClick={() => onSelect(hero.id)}
            >
              <img
                src={hero.criticalImage || hero.image}
                alt=""
                onError={(event) => {
                  if (event.currentTarget.getAttribute("src") !== hero.image)
                    event.currentTarget.src = hero.image;
                }}
              />
              <span>{hero.name}</span>
            </button>
          ))}
        </div>
        {filtered.length === 0 && <p>No heroes match this search.</p>}
      </section>
    </div>
  );
}

function LogoField({ title, value, onUpload, onRemove }) {
  return (
    <div className="mo-logo-field">
      <span className="mo-logo-preview">
        {value ? <img src={value} alt={title} /> : "＋"}
      </span>
      <div>
        <span className="mo-team-caption">{title}</span>
        <div className="mo-actions">
          <label className="button secondary mo-upload">
            Upload logo
            <input
              type="file"
              aria-label={`Upload ${title.toLowerCase()}`}
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => {
                onUpload(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </label>
          {value && (
            <button className="mo-text-button" onClick={onRemove}>
              Remove logo
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function MatchOverlayControls({
  active,
  config,
  snapshot,
  onOpenDraft,
}) {
  const shared = useWorkspace();
  const [rawSettings, setSettings] = useWorkspaceField(
    ["matchOverlay"],
    cleanMatchOverlay(),
  );
  const settings = cleanMatchOverlay(rawSettings);
  const workspace = {
    ...shared?.data,
    config,
    draft: { ...shared?.data?.draft, snapshot },
    matchOverlay: settings,
  };
  const { session } = useCollector(shared?.data?.deadem?.id, active);
  const resolved = resolveMatchOverlay(workspace, session);
  const sourceHeight = Math.max(
    102,
    settings.playerNames.enabled
      ? settings.playerNames.layout.y + settings.playerNames.layout.height
      : 0,
  );
  const readOnly = Boolean(shared?.readOnly || shared?.changingTournament);
  const [guide, setGuide] = useState(false);
  const [picker, setPicker] = useState(null);
  const [notice, setNotice] = useState("");
  const [previewScale, setPreviewScale] = useState(0.5);
  const previewRef = useRef(null);
  const mounted = useRef(true);
  const editingContext = useRef(null);
  useEffect(() => {
    editingContext.current = {
      readOnly,
      tournamentId: shared?.data.activeTournamentId,
    };
  }, [readOnly, shared?.data.activeTournamentId]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!active || !previewRef.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0)
        setPreviewScale(entry.contentRect.width / 1920);
    });
    observer.observe(previewRef.current);
    return () => observer.disconnect();
  }, [active]);

  const update = (change) => {
    if (readOnly) return;
    setSettings((current) => {
      const clean = cleanMatchOverlay(current);
      return cleanMatchOverlay(
        typeof change === "function" ? change(clean) : { ...clean, ...change },
      );
    });
  };
  const updateTeam = (index, change) =>
    update((current) => ({
      ...current,
      teams: current.teams.map((team, teamIndex) =>
        teamIndex === index ? { ...team, ...change } : team,
      ),
    }));
  const toggleLink = (key, linked) =>
    update((current) => {
      const displayed = resolveMatchOverlay(
        { ...workspace, matchOverlay: current },
        session,
      );
      let next = current;
      if (!linked) {
        if (key === "event")
          next = {
            ...next,
            tournament: {
              ...next.tournament,
              name: displayed.tournament.name,
            },
          };
        else
          next = {
            ...next,
            teams: next.teams.map((team, index) => ({
              ...team,
              ...(key === "names" ? { name: displayed.teams[index].name } : {}),
              ...(key === "bans"
                ? { bans: [...displayed.teams[index].bans] }
                : {}),
              ...(key === "scores"
                ? { scoreBoxes: [...displayed.teams[index].scoreBoxes] }
                : {}),
            })),
          };
      }
      return { ...next, links: { ...next.links, [key]: linked } };
    });
  const uploadLogo = async (file, key) => {
    if (!file || readOnly) return;
    const tournamentId = shared?.data.activeTournamentId;
    if (
      !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
      file.size > 5 * 1024 * 1024
    ) {
      setNotice("Choose a PNG, JPEG, or WebP image under 5 MB.");
      return;
    }
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const ratio = Math.min(320 / image.width, 320 / image.height, 1);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * ratio));
      canvas.height = Math.max(1, Math.round(image.height * ratio));
      canvas
        .getContext("2d")
        .drawImage(image, 0, 0, canvas.width, canvas.height);
      const logo = canvas.toDataURL("image/webp", 0.88);
      if (logo.length > 300000) throw new Error("large-image");
      if (
        !mounted.current ||
        editingContext.current?.readOnly ||
        editingContext.current?.tournamentId !== tournamentId
      )
        return;
      update((current) => ({
        ...current,
        [key]: { ...current[key], logo },
      }));
      setNotice(`${key === "center" ? "Center" : "Sponsor"} logo updated.`);
    } catch (error) {
      if (mounted.current)
        setNotice(
          error.message === "large-image"
            ? "Try a smaller or simpler logo image."
            : "That image could not be opened. Try another file.",
        );
    } finally {
      URL.revokeObjectURL(url);
    }
  };
  const outputUrl = new URL("/obs/match-overlay", window.location.origin).href;
  const wins = matchOverlayWins(resolved.format);
  const linkSwitch = (key, label) => (
    <label className="mo-switch">
      <input
        type="checkbox"
        checked={settings.links[key]}
        onChange={(event) => toggleLink(key, event.target.checked)}
      />
      {label}
    </label>
  );
  const showPicker = (teamIndex, slot) => {
    if (!readOnly && !settings.links.bans) setPicker({ teamIndex, slot });
  };
  const updatePlayerName = (player, teamIndex, slot, name) =>
    update((current) => {
      const next = { ...current.playerNames };
      if (player.id.startsWith("manual-")) {
        next.manual = next.manual.map((team, index) =>
          index === teamIndex
            ? team.map((value, position) => (position === slot ? name : value))
            : team,
        );
      } else {
        next.overrides = { ...next.overrides };
        if (name.trim()) next.overrides[player.id] = name;
        else delete next.overrides[player.id];
      }
      return { ...current, playerNames: next };
    });
  const updateNameLayout = (key, value) =>
    update((current) => ({
      ...current,
      playerNames: {
        ...current.playerNames,
        layout: { ...current.playerNames.layout, [key]: value },
      },
    }));

  return (
    <section className="match-overlay-controls" hidden={!active}>
      <div className="page-heading">
        <div>
          <span className="eyebrow">THE MATCH, AT A GLANCE</span>
          <h1>
            Match overlay<span>✦</span>
          </h1>
          <p>
            Team names, bans, and series wins in a compact banner. Linked
            details follow your draft and broadcast settings as they change.
          </p>
        </div>
        <span
          className={`mo-live-state ${settings.visible ? "" : "is-hidden"}`}
        >
          {settings.visible ? "Visible in OBS" : "Hidden in OBS"}
        </span>
      </div>

      <section className="mo-card">
        <div className="mo-card-head">
          <div>
            <h2>Live preview</h2>
            <p>The checkerboard shows the transparent areas of your source.</p>
          </div>
          <button
            className={`button ${settings.visible ? "secondary" : "primary"}`}
            disabled={readOnly}
            onClick={() => update({ visible: !settings.visible })}
          >
            {settings.visible ? "Hide overlay" : "Show overlay"}
          </button>
        </div>
        <div
          className="mo-preview"
          ref={previewRef}
          style={{ height: sourceHeight * previewScale }}
        >
          <div
            className="mo-preview-stage"
            style={{
              transform: `scale(${previewScale})`,
              height: sourceHeight,
            }}
          >
            <MatchOverlay state={resolved} guide={guide} />
            {!resolved.visible && (
              <span className="mo-preview-empty">
                The overlay is hidden in OBS.
              </span>
            )}
          </div>
        </div>
        <div className="mo-preview-footer">
          <p>
            1920 × {sourceHeight} source · transparent · {resolved.format}
          </p>
          <label className="mo-switch">
            <input
              type="checkbox"
              checked={guide}
              onChange={(event) => setGuide(event.target.checked)}
            />
            Show 35 px HUD guide in preview
          </label>
        </div>
      </section>

      <section className="mo-card mo-source">
        <div className="mo-card-head">
          <div>
            <h2>Permanent OBS source</h2>
            <p>
              Add this once as a Browser Source, with width 1920 and height{" "}
              {sourceHeight}.
            </p>
          </div>
        </div>
        <div className="mo-source-url">
          <input
            aria-label="Match overlay permanent OBS URL"
            value={outputUrl}
            readOnly
            onFocus={(event) => event.target.select()}
          />
          <button
            className="button primary"
            onClick={() =>
              navigator.clipboard
                .writeText(outputUrl)
                .then(() => setNotice("Match overlay URL copied."))
                .catch(() => setNotice("Select the URL and copy it manually."))
            }
          >
            Copy URL
          </button>
          <a
            className="button secondary"
            href={outputUrl}
            target="_blank"
            rel="noreferrer"
          >
            Open output ↗
          </a>
        </div>
        <p className="mo-source-note">
          Changes here update the shared source automatically. Switching
          tournaments keeps this same link and shows the active tournament.
        </p>
      </section>

      {notice && (
        <p className="mo-notice" role="status">
          {notice}
        </p>
      )}
      {readOnly && (
        <p>This workspace is open for viewing. Editing is unavailable.</p>
      )}

      <fieldset className="mo-fieldset" disabled={readOnly}>
        <div className="mo-grid">
          <section className="mo-card">
            <div className="mo-card-head">
              <div>
                <h2>Match details</h2>
                <p>Turn off a link to edit this overlay independently.</p>
              </div>
              <button className="mo-text-button" onClick={onOpenDraft}>
                Open Draft studio ↗
              </button>
            </div>
            <div className="mo-section">
              <div className="mo-setting-grid">
                <label>
                  Series format
                  <select
                    aria-label="Series format"
                    value={settings.format}
                    onChange={(event) => update({ format: event.target.value })}
                  >
                    <option value="linked">
                      Follow broadcast format ({config.format})
                    </option>
                    <option value="BO1">Best of 1</option>
                    <option value="BO3">Best of 3</option>
                  </select>
                </label>
                <label>
                  Team name font
                  <select
                    aria-label="Team name font"
                    value={settings.font}
                    onChange={(event) => update({ font: event.target.value })}
                    style={{
                      fontFamily: MATCH_OVERLAY_FONTS.find(
                        (font) => font.id === settings.font,
                      )?.family,
                    }}
                  >
                    {MATCH_OVERLAY_FONTS.map((font) => (
                      <option
                        key={font.id}
                        value={font.id}
                        style={{ fontFamily: font.family }}
                      >
                        {font.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            <div className="mo-section">
              <div className="mo-section-head">
                <h3>Team names</h3>
                {linkSwitch("names", "Follow draft team names")}
              </div>
              <div className="mo-team-grid">
                {resolved.teams.map((team, index) => (
                  <label key={index}>
                    {index === 0 ? "Left team" : "Right team"}
                    <input
                      value={
                        settings.links.names
                          ? team.name
                          : settings.teams[index].name
                      }
                      readOnly={settings.links.names}
                      maxLength={48}
                      onChange={(event) =>
                        updateTeam(index, { name: event.target.value })
                      }
                    />
                  </label>
                ))}
              </div>
            </div>

            <div className="mo-section">
              <div className="mo-section-head">
                <h3>Bans</h3>
                {linkSwitch("bans", "Follow draft bans")}
              </div>
              {settings.links.bans && (
                <p className="mo-linked-note">
                  Bans follow the current draft, including empty slots when it
                  resets.
                </p>
              )}
              <div className="mo-team-grid">
                {resolved.teams.map((team, teamIndex) => (
                  <div key={teamIndex}>
                    <span className="mo-team-caption">{team.name}</span>
                    <div className="mo-ban-slots">
                      {team.bans.map((heroId, slot) => {
                        const hero = roster[heroId];
                        return (
                          <button
                            key={slot}
                            className={`mo-ban-slot ${hero ? "has-hero" : ""}`}
                            disabled={settings.links.bans}
                            aria-label={`${team.name} ban ${slot + 1}: ${hero?.name || "empty"}${settings.links.bans ? ", linked to draft" : ", choose hero"}`}
                            title={hero?.name || "Choose a banned hero"}
                            onClick={() => showPicker(teamIndex, slot)}
                          >
                            {hero ? (
                              <img
                                src={hero.criticalImage || hero.image}
                                alt=""
                              />
                            ) : (
                              "＋"
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
              {!settings.links.bans && (
                <p>Choose any ban slot to search all {heroes.length} heroes.</p>
              )}
            </div>

            <div className="mo-section">
              <div className="mo-section-head">
                <h3>Series wins</h3>
                {linkSwitch("scores", "Follow broadcast scores")}
              </div>
              <div className="mo-team-grid">
                {resolved.teams.map((team, teamIndex) => (
                  <div key={teamIndex}>
                    <span className="mo-team-caption">{team.name}</span>
                    <div className="mo-score-row">
                      {Array.from({ length: wins }, (_, slot) => (
                        <button
                          key={slot}
                          className={`mo-score-box ${team.scoreBoxes[slot] ? "is-filled" : ""}`}
                          style={{ "--mo-score-accent": team.accent }}
                          disabled={settings.links.scores}
                          aria-label={`${team.name} win ${slot + 1}${settings.links.scores ? ", linked to broadcast score" : ""}`}
                          aria-pressed={team.scoreBoxes[slot]}
                          onClick={() =>
                            update((current) => ({
                              ...current,
                              teams: current.teams.map((item, index) =>
                                index === teamIndex
                                  ? {
                                      ...item,
                                      scoreBoxes: item.scoreBoxes.map(
                                        (filled, box) =>
                                          box === slot ? !filled : filled,
                                      ),
                                    }
                                  : item,
                              ),
                            }))
                          }
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <p>
                {settings.links.scores
                  ? "Filled boxes follow the scores in Broadcast settings."
                  : "Click a box to fill or clear it. Each filled box is one game won."}
              </p>
            </div>
          </section>

          <section className="mo-card">
            <div className="mo-card-head">
              <div>
                <h2>Identity & appearance</h2>
                <p>Keep your event and partner details together.</p>
              </div>
            </div>
            <div className="mo-section">
              <label className="mo-opacity-control">
                <span className="mo-range-heading">
                  Background opacity
                  <output>{settings.backgroundOpacity}%</output>
                </span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={settings.backgroundOpacity}
                  aria-label="Background opacity"
                  aria-valuetext={`${settings.backgroundOpacity}% opaque`}
                  onChange={(event) =>
                    update({ backgroundOpacity: Number(event.target.value) })
                  }
                />
                <span className="mo-range-scale">
                  <span>Transparent</span>
                  <span>Solid</span>
                </span>
              </label>
              <p>
                Lower this to soften the banner colors. Names, scores, and hero
                portraits stay sharp. Try 85–90% to start.
              </p>
            </div>
            <div className="mo-section">
              <div className="mo-section-head">
                <h3>Tournament</h3>
                {linkSwitch("event", "Follow event name")}
              </div>
              <div className="mo-stack">
                <label>
                  Tournament name
                  <input
                    value={
                      settings.links.event
                        ? resolved.tournament.name
                        : settings.tournament.name
                    }
                    readOnly={settings.links.event}
                    maxLength={80}
                    onChange={(event) =>
                      update((current) => ({
                        ...current,
                        tournament: {
                          ...current.tournament,
                          name: event.target.value,
                        },
                      }))
                    }
                  />
                </label>
                <label>
                  Tournament subtitle
                  <textarea
                    value={settings.tournament.subtitle}
                    rows={2}
                    maxLength={100}
                    onChange={(event) =>
                      update((current) => ({
                        ...current,
                        tournament: {
                          ...current.tournament,
                          subtitle: event.target.value,
                        },
                      }))
                    }
                  />
                </label>
              </div>
            </div>
            <div className="mo-section">
              <div className="mo-section-head">
                <h3>Sponsor</h3>
              </div>
              <div className="mo-stack">
                <label>
                  Sponsor heading
                  <input
                    value={settings.sponsor.heading}
                    maxLength={48}
                    onChange={(event) =>
                      update((current) => ({
                        ...current,
                        sponsor: {
                          ...current.sponsor,
                          heading: event.target.value,
                        },
                      }))
                    }
                  />
                </label>
                <label>
                  Sponsor name
                  <textarea
                    rows={2}
                    value={settings.sponsor.name}
                    maxLength={100}
                    onChange={(event) =>
                      update((current) => ({
                        ...current,
                        sponsor: {
                          ...current.sponsor,
                          name: event.target.value,
                        },
                      }))
                    }
                  />
                </label>
                <LogoField
                  title="Sponsor logo"
                  value={settings.sponsor.logo}
                  onUpload={(file) => uploadLogo(file, "sponsor")}
                  onRemove={() =>
                    update((current) => ({
                      ...current,
                      sponsor: { ...current.sponsor, logo: null },
                    }))
                  }
                />
              </div>
            </div>
            <div className="mo-section">
              <div className="mo-section-head">
                <h3>Center mark</h3>
              </div>
              <LogoField
                title="Center logo"
                value={settings.center.logo}
                onUpload={(file) => uploadLogo(file, "center")}
                onRemove={() =>
                  update((current) => ({
                    ...current,
                    center: { ...current.center, logo: null },
                  }))
                }
              />
              <p>Upload your own mark to show it between the teams.</p>
            </div>
            <div className="mo-section">
              <div className="mo-section-head">
                <h3>Team accents</h3>
              </div>
              <div className="mo-team-grid">
                {settings.teams.map((team, index) => (
                  <label key={index}>
                    {index === 0 ? "Left accent" : "Right accent"}
                    <span className="mo-color-field">
                      <input
                        type="color"
                        value={team.accent}
                        aria-label={`${index === 0 ? "Left" : "Right"} team accent color`}
                        onChange={(event) =>
                          updateTeam(index, { accent: event.target.value })
                        }
                      />
                      <input
                        key={team.accent}
                        type="text"
                        defaultValue={team.accent}
                        aria-label={`${index === 0 ? "Left" : "Right"} team accent hex`}
                        maxLength={7}
                        pattern="#[0-9a-fA-F]{6}"
                        onBlur={(event) => {
                          if (/^#[0-9a-f]{6}$/i.test(event.target.value))
                            updateTeam(index, { accent: event.target.value });
                          else event.target.value = team.accent;
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") event.currentTarget.blur();
                        }}
                      />
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </section>
        </div>
        <section className="mo-card mo-player-names">
          <div className="mo-card-head">
            <div>
              <h2>Player name boxes</h2>
              <p>
                Clean labels under the banner, lined up with the game’s hero
                portraits.
              </p>
            </div>
            <label className="mo-switch">
              <input
                type="checkbox"
                checked={settings.playerNames.enabled}
                onChange={(event) =>
                  update((current) => ({
                    ...current,
                    playerNames: {
                      ...current.playerNames,
                      enabled: event.target.checked,
                    },
                  }))
                }
              />
              Show player name boxes
            </label>
          </div>
          {settings.playerNames.enabled && (
            <>
              <p className="mo-linked-note">
                {resolved.playerNames.source === "manual"
                  ? "Enter names below while waiting for game information. Once players arrive from Live stats, their names and portrait order are used automatically."
                  : "Names follow the current game and the portrait order set in Live stats. A custom name stays with its player when you swap positions."}{" "}
                <a href="/?tab=live">Open Live stats ↗</a>
              </p>
              <div className="mo-player-teams">
                {resolved.playerNames.teams.map((players, teamIndex) => (
                  <div key={teamIndex} className="mo-player-team">
                    <h3>{resolved.teams[teamIndex].name}</h3>
                    {players.map((player, slot) => {
                      const hero = roster[player.heroId];
                      const manualSlot = player.id.startsWith("manual-");
                      const hasOverride = Object.hasOwn(
                        settings.playerNames.overrides,
                        player.id,
                      );
                      const label = `${teamIndex === 0 ? "Left" : "Right"} player ${slot + 1} name`;
                      return (
                        <div className="mo-player-row" key={player.id}>
                          <span
                            className="mo-player-portrait"
                            aria-hidden="true"
                          >
                            {hero ? <img src={hero.image} alt="" /> : slot + 1}
                          </span>
                          <label>
                            <span className="mo-player-label">
                              <span>
                                Position {slot + 1}
                                {hero ? ` · ${hero.name}` : ""}
                              </span>
                              {hasOverride && (
                                <span className="mo-custom-name">Custom</span>
                              )}
                            </span>
                            <input
                              aria-label={label}
                              value={player.name}
                              placeholder={
                                manualSlot
                                  ? "Enter player name"
                                  : "Live player name"
                              }
                              maxLength={48}
                              onChange={(event) =>
                                updatePlayerName(
                                  player,
                                  teamIndex,
                                  slot,
                                  event.target.value,
                                )
                              }
                            />
                            {!manualSlot && (
                              <span className="mo-player-source">
                                Live name:{" "}
                                {player.sourceName || "Waiting for name"}
                              </span>
                            )}
                          </label>
                          {!manualSlot && (
                            <button
                              className="mo-text-button mo-reset-name"
                              disabled={!hasOverride}
                              aria-label={`Use live name for ${teamIndex === 0 ? "left" : "right"} player ${slot + 1}`}
                              onClick={() =>
                                updatePlayerName(player, teamIndex, slot, "")
                              }
                            >
                              Use live
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
              <details className="mo-name-placement">
                <summary>Adjust name box placement</summary>
                <p>
                  Match the row to your game view. Positions use a 1920 px wide
                  canvas.
                </p>
                <div className="mo-placement-grid">
                  {[
                    ["x", "Left position", 0, 1919],
                    ["y", "Top position", 0, 1058],
                    ["width", "Box width", 24, 250],
                    ["height", "Box height", 12, 70],
                    ["gap", "Gap between players", 0, 80],
                    ["teamGap", "Extra gap between teams", 0, 500],
                    ["fontSize", "Name text size", 8, 30],
                  ].map(([key, label, min, max]) => (
                    <label key={key}>
                      {label}
                      <input
                        key={settings.playerNames.layout[key]}
                        aria-label={`Player name ${label.toLowerCase()}`}
                        type="number"
                        min={min}
                        max={max}
                        step={1}
                        defaultValue={settings.playerNames.layout[key]}
                        onBlur={(event) => {
                          if (event.target.value !== "")
                            updateNameLayout(key, Number(event.target.value));
                          else
                            event.target.value =
                              settings.playerNames.layout[key];
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") event.currentTarget.blur();
                        }}
                      />
                    </label>
                  ))}
                </div>
                <button
                  className="mo-text-button"
                  onClick={() =>
                    update((current) => ({
                      ...current,
                      playerNames: {
                        ...current.playerNames,
                        layout: cleanMatchOverlay().playerNames.layout,
                      },
                    }))
                  }
                >
                  Reset name box placement
                </button>
              </details>
            </>
          )}
        </section>
      </fieldset>

      {picker && !readOnly && (
        <HeroPicker
          title={`${resolved.teams[picker.teamIndex].name} · ban ${picker.slot + 1}`}
          value={settings.teams[picker.teamIndex].bans[picker.slot]}
          onClose={() => setPicker(null)}
          onSelect={(heroId) => {
            update((current) => ({
              ...current,
              teams: current.teams.map((team, index) =>
                index === picker.teamIndex
                  ? {
                      ...team,
                      bans: team.bans.map((id, slot) =>
                        slot === picker.slot ? heroId : id,
                      ),
                    }
                  : team,
              ),
            }));
            setPicker(null);
          }}
        />
      )}
    </section>
  );
}

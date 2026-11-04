import { useEffect, useRef, useState } from "react";
import { bracketOutput } from "./bracket.js";
import {
  cleanPlayerBanners,
  resolveBannerTeams,
  playerBannersOutput,
  normalizeBannerSteamId,
} from "./player-banners.js";
import { useWorkspace, workspaceRequest } from "./workspace-context.js";
import PlayerBannersScreen from "./PlayerBannersScreen.jsx";
import "./PlayerBannersStudio.css";

const timestamp = (value) =>
  value
    ? new Date(value).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "Not fetched yet";

function ManualTeam({ team, side, library, disabled, onChange }) {
  const updatePlayer = (slot, changes) =>
    onChange({
      ...team,
      players: team.players.map((person, index) =>
        index === slot ? { ...person, ...changes } : person,
      ),
    });
  return (
    <fieldset className="pbs-manual-team" disabled={disabled}>
      <legend>Team {side + 1}</legend>
      <label>
        Load a saved team
        <select
          aria-label={`Banner team ${side + 1} saved team`}
          value=""
          onChange={(event) => {
            const saved = library.teams.find(
              (item) => item.id === event.target.value,
            );
            if (!saved) return;
            const roster =
              saved.playerIds
                ?.map((id) =>
                  library.players.find((person) => person.id === id),
                )
                .filter(Boolean) ||
              saved.players ||
              [];
            onChange(
              cleanPlayerBanners({ teams: [{ ...saved, players: roster }] })
                .teams[0],
            );
          }}
        >
          <option value="">Choose from the team library…</option>
          {library.teams.map((saved) => (
            <option key={saved.id} value={saved.id}>
              {saved.name}
            </option>
          ))}
        </select>
      </label>
      <div className="pbs-team-identity">
        <label>
          Team name
          <input
            aria-label={`Banner team ${side + 1} name`}
            value={team.name}
            maxLength={80}
            placeholder={`Team ${side + 1}`}
            onChange={(event) =>
              onChange({ ...team, name: event.target.value })
            }
          />
        </label>
        <label>
          Short tag
          <input
            aria-label={`Banner team ${side + 1} tag`}
            value={team.tag}
            maxLength={8}
            placeholder="TAG"
            onChange={(event) => onChange({ ...team, tag: event.target.value })}
          />
        </label>
      </div>
      <div className="pbs-manual-players">
        {team.players.map((person, slot) => (
          <article className="pbs-manual-player" key={slot}>
            <div className="pbs-player-row-heading">
              <span>PLAYER 0{slot + 1}</span>
              <button
                className="pbs-text-button"
                onClick={() =>
                  updatePlayer(slot, { id: "", name: "", steamId: "" })
                }
                type="button"
                disabled={!person.name && !person.steamId}
                aria-label={`Clear banner team ${side + 1} player ${slot + 1}`}
              >
                Clear
              </button>
            </div>
            <label>
              Saved player
              <select
                aria-label={`Banner team ${side + 1} player ${slot + 1} saved player`}
                value=""
                onChange={(event) => {
                  const saved = library.players.find(
                    (item) => item.id === event.target.value,
                  );
                  if (saved)
                    updatePlayer(slot, {
                      id: saved.id,
                      name: saved.name,
                      steamId: saved.steamId || "",
                    });
                }}
              >
                <option value="">Choose a saved player…</option>
                {library.players.map((saved) => (
                  <option key={saved.id} value={saved.id}>
                    {saved.name || saved.steamId}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Display name
              <input
                aria-label={`Banner team ${side + 1} player ${slot + 1} name`}
                value={person.name}
                maxLength={48}
                placeholder="Leave blank to use Steam name"
                onChange={(event) =>
                  updatePlayer(slot, { name: event.target.value })
                }
              />
            </label>
            <label>
              Steam account
              <input
                aria-label={`Banner team ${side + 1} player ${slot + 1} Steam account`}
                value={person.steamId}
                maxLength={160}
                placeholder="SteamID64, account ID or profile link"
                onChange={(event) =>
                  updatePlayer(slot, { steamId: event.target.value })
                }
              />
            </label>
          </article>
        ))}
      </div>
    </fieldset>
  );
}

export default function PlayerBannersStudio({ active = true }) {
  const shared = useWorkspace();
  const workspace = shared?.data || {};
  const settings = cleanPlayerBanners(workspace.playerBanners);
  const publicView = playerBannersOutput(workspace);
  const teams = resolveBannerTeams(workspace);
  const matches = bracketOutput(workspace.bracket).rounds.flatMap((round) =>
    round.matches
      .filter(
        (match) =>
          match.required !== false &&
          ["ready", "complete"].includes(match.status) &&
          match.teams.every(Boolean),
      )
      .map((match) => ({ ...match, roundName: round.name })),
  );
  const [library, setLibrary] = useState({ teams: [], players: [] });
  const [libraryRefresh, setLibraryRefresh] = useState(0);
  const [draft, setDraft] = useState(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [scale, setScale] = useState(0.5);
  const preview = useRef(null);
  const disabled =
    busy ||
    Boolean(shared?.saving || shared?.readOnly || shared?.changingTournament);
  const dirty =
    settings.source === "manual" &&
    draft !== null &&
    JSON.stringify(draft.teams) !== JSON.stringify(settings.teams);
  const outputUrl = new URL("/obs/player-banners", window.location.origin).href;
  const roster = draft?.teams || settings.teams;
  const accounts = new Set(
    teams
      .flatMap((team) => team.players.map((person) => person.steamId))
      .filter(Boolean),
  );
  useEffect(() => {
    if (!active) return;
    let live = true;
    workspaceRequest("roster-library")
      .then((value) => {
        if (live) setLibrary(value);
      })
      .catch((error) => {
        if (live) setNotice(error.message);
      });
    return () => {
      live = false;
    };
  }, [active, libraryRefresh]);
  useEffect(() => {
    if (!active || !preview.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0) setScale(entry.contentRect.width / 1920);
    });
    observer.observe(preview.current);
    return () => observer.disconnect();
  }, [active]);
  const update = (key, value) => {
    if (!disabled) shared.update(["playerBanners", key], value);
  };
  const editTeams = (value) => {
    setDraft((current) => ({
      base: current?.base || JSON.stringify(settings.teams),
      teams: value,
    }));
    setNotice("");
  };
  const saveManual = () => {
    if (disabled || !draft) return;
    if (draft.base !== JSON.stringify(settings.teams)) {
      setNotice(
        "Another admin changed the manual rosters. Discard your edits and review the current teams before trying again.",
      );
      return;
    }
    const seen = new Set();
    for (const [side, team] of draft.teams.entries()) {
      for (const [slot, person] of team.players.entries()) {
        const raw = person.steamId.trim();
        const steamId = normalizeBannerSteamId(raw);
        if (raw && !steamId) {
          setNotice(
            `Team ${side + 1}, player ${slot + 1}: enter a numeric SteamID, account ID, or steamcommunity.com/profiles link.`,
          );
          return;
        }
        if (steamId && seen.has(steamId)) {
          setNotice(
            "Each Steam account can appear only once across the two rosters.",
          );
          return;
        }
        if (steamId) seen.add(steamId);
      }
    }
    const cleaned = cleanPlayerBanners({ teams: draft.teams }).teams;
    shared.update(["playerBanners", "teams"], cleaned);
    setDraft(null);
    setNotice(
      "Manual rosters saved. Choose Get statistics to load player profiles.",
    );
  };
  async function refresh(force = false) {
    if (disabled || dirty) return;
    setBusy(true);
    setNotice("");
    try {
      await shared.command("player-banners/refresh", { force });
      setNotice(
        "Player statistics updated. Review each player’s status below.",
      );
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }
  if (!active) return null;
  return (
    <section className="player-banners-studio">
      <div className="page-heading">
        <div>
          <span className="eyebrow">THE PLAYERS BEHIND THE PLAY</span>
          <h1>
            Player banners<span>✦</span>
          </h1>
          <p>
            Introduce both teams with six player cards each, their most-played
            heroes and optional rank badges.
          </p>
        </div>
        <span
          className={`pbs-live-state${settings.visible ? "" : " is-hidden"}`}
        >
          {settings.visible ? "Visible in OBS" : "Hidden in OBS"}
        </span>
      </div>
      {notice && (
        <p className="pbs-notice" role="status">
          {notice}
        </p>
      )}
      <section className="pbs-card">
        <div className="pbs-card-head">
          <div>
            <h2>Live preview</h2>
            <p>
              Your permanent OBS source follows these settings automatically.
            </p>
          </div>
          <button
            className="button secondary"
            disabled={disabled}
            onClick={() => update("visible", !settings.visible)}
          >
            {settings.visible ? "Hide player banners" : "Show player banners"}
          </button>
        </div>
        <div
          className="pbs-preview"
          ref={preview}
          style={{ height: scale * 1080 }}
        >
          <div
            className="pbs-preview-stage"
            style={{ transform: `scale(${scale})` }}
          >
            <PlayerBannersScreen banners={{ ...publicView, visible: true }} />
          </div>
          {!settings.visible && (
            <span className="pbs-preview-hidden">Preview · hidden in OBS</span>
          )}
        </div>
        <div className="pbs-preview-footer">
          <span>1920 × 1080 · two teams · six players per team</span>
          <label className="pbs-switch">
            <input
              type="checkbox"
              checked={settings.transparent}
              disabled={disabled}
              onChange={(event) => update("transparent", event.target.checked)}
            />
            Transparent background
          </label>
          <label className="pbs-switch">
            <input
              type="checkbox"
              checked={settings.showRanks}
              disabled={disabled}
              onChange={(event) => update("showRanks", event.target.checked)}
            />
            Show rank badges
          </label>
        </div>
      </section>
      <section className="pbs-card pbs-source">
        <h2>Permanent OBS source</h2>
        <p>
          Add a Browser Source at 1920 × 1080. The URL stays the same when you
          switch tournaments or matches.
        </p>
        <div className="pbs-source-row">
          <input
            aria-label="Player banners permanent OBS URL"
            value={outputUrl}
            readOnly
            onFocus={(event) => event.target.select()}
          />
          <button
            className="button primary"
            onClick={() =>
              navigator.clipboard
                .writeText(outputUrl)
                .then(() => setNotice("Player banners URL copied."))
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
      </section>
      <section className="pbs-card">
        <div className="pbs-card-head">
          <div>
            <h2>Choose the teams</h2>
            <p>
              Link tournament rosters or prepare your own names and Steam
              accounts.
            </p>
          </div>
          <span className="pbs-step">01 / THE ROSTERS</span>
        </div>
        <div className="pbs-source-settings">
          <label>
            Roster source
            <select
              aria-label="Player banners roster source"
              value={settings.source}
              disabled={disabled}
              onChange={(event) => update("source", event.target.value)}
            >
              <option value="broadcast">Current broadcast teams</option>
              <option value="bracket">Bracket match</option>
              <option value="manual">Manual rosters</option>
            </select>
          </label>
          {settings.source === "bracket" && (
            <label>
              Bracket match
              <select
                aria-label="Player banners bracket match"
                value={
                  matches.some((match) => match.id === settings.matchId)
                    ? settings.matchId
                    : ""
                }
                disabled={disabled}
                onChange={(event) => update("matchId", event.target.value)}
              >
                <option value="">
                  {matches.length
                    ? "Choose a match…"
                    : "No matches with both teams yet"}
                </option>
                {matches.map((match) => (
                  <option value={match.id} key={match.id}>
                    {match.roundName} · {match.teams[0].name} vs{" "}
                    {match.teams[1].name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {settings.source === "broadcast" && (
          <p>
            Names follow the current broadcast. Player accounts come from
            matching teams in this tournament’s bracket. Add rosters in{" "}
            <a href="/?tab=bracket">Bracket ↗</a>, or use manual rosters here.
          </p>
        )}
        {settings.source === "bracket" && (
          <p>
            Team names and players follow the selected bracket match, including
            later roster edits.
          </p>
        )}
        {settings.source !== "manual" && (
          <button
            className="button secondary"
            disabled={disabled}
            onClick={() => {
              setDraft(null);
              shared.update(["playerBanners", "teams"], structuredClone(teams));
              update("source", "manual");
              setNotice(
                "Current teams copied to manual rosters. Edit player names or accounts below, then save your edits.",
              );
            }}
          >
            Copy current teams to manual
          </button>
        )}
        {settings.source === "manual" && (
          <>
            <div className="pbs-manual-toolbar">
              <p>
                Leave a display name blank to use the Steam name after fetching.
                Empty slots keep their position. These edits apply only to this
                tournament’s banners.
              </p>
              <button
                className="button secondary"
                disabled={disabled}
                onClick={() => setLibraryRefresh((value) => value + 1)}
              >
                Refresh saved library
              </button>
            </div>
            <div className="pbs-manual-grid">
              {roster.map((team, side) => (
                <ManualTeam
                  key={side}
                  team={team}
                  side={side}
                  library={library}
                  disabled={disabled}
                  onChange={(next) =>
                    editTeams(
                      roster.map((item, index) =>
                        index === side ? next : item,
                      ),
                    )
                  }
                />
              ))}
            </div>
            <div className="pbs-actions">
              <button
                className="button primary"
                disabled={disabled || !dirty}
                onClick={saveManual}
              >
                Save manual rosters
              </button>
              {draft && (
                <button
                  className="button secondary"
                  disabled={disabled}
                  onClick={() => {
                    setDraft(null);
                    setNotice("Manual edits discarded.");
                  }}
                >
                  Discard manual edits
                </button>
              )}
            </div>
            <p>
              Reusable team and player records are managed in{" "}
              <a href="/?tab=data">Data library ↗</a>.
            </p>
          </>
        )}
      </section>
      <section className="pbs-card">
        <div className="pbs-card-head">
          <div>
            <h2>Player statistics</h2>
            <p>
              Choose Get statistics after selecting teams. Recent saved profiles
              are reused; Refresh statistics requests newer data.
            </p>
          </div>
          <span className="pbs-step">02 / THE PLAYERS</span>
        </div>
        <div className="pbs-actions">
          <button
            className="button primary"
            disabled={disabled || dirty || !accounts.size}
            onClick={() => refresh(false)}
          >
            {busy ? "Getting statistics…" : "Get statistics"}
          </button>
          <button
            className="button secondary"
            disabled={disabled || dirty || !accounts.size}
            onClick={() => refresh(true)}
          >
            Refresh statistics
          </button>
          <span className="pbs-account-count">
            {accounts.size} linked Steam{" "}
            {accounts.size === 1 ? "account" : "accounts"}
          </span>
        </div>
        {dirty && (
          <p className="pbs-inline-note">
            Save or discard manual roster edits before fetching statistics.
          </p>
        )}
        {!accounts.size && (
          <p className="pbs-inline-note">
            Add Steam accounts to these players to fetch hero statistics and
            rank badges.
          </p>
        )}
        <div className="pbs-roster-overview">
          {teams.map((team, side) => (
            <section className="pbs-team-status" key={side}>
              <h3>{team.name || `Team ${side + 1}`}</h3>
              <ol>
                {team.players.map((person, slot) => {
                  const profile = settings.profiles[person.steamId];
                  const name =
                    person.name || profile?.personaName || `Player ${slot + 1}`;
                  const status = !person.steamId
                    ? "No Steam account"
                    : !profile
                      ? "Ready to fetch"
                      : profile.status === "error"
                        ? profile.updatedAt
                          ? "Last available stats"
                          : "Unavailable"
                        : profile.status === "empty"
                          ? "No tracked matches"
                          : "Statistics ready";
                  return (
                    <li key={slot}>
                      <span className="pbs-status-position">0{slot + 1}</span>
                      <div>
                        <strong>{name}</strong>
                        <span
                          className={`pbs-profile-status${profile?.status === "error" ? " is-error" : ""}`}
                        >
                          {status}
                        </span>
                        <small>
                          {person.steamId
                            ? timestamp(profile?.updatedAt)
                            : "Add an account in the team roster"}
                        </small>
                        {profile?.error && (
                          <p className="pbs-profile-error">{profile.error}</p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
        </div>
        <p className="pbs-data-note">
          Top heroes use matches tracked by Deadlock API, which may not include
          a player’s full history. Rank badges show the latest reported rank
          when available. Missing ranks and unavailable statistics remain
          clearly marked.
        </p>
      </section>
    </section>
  );
}

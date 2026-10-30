import { useEffect, useRef, useState } from "react";
import { useWorkspace, workspaceRequest } from "./workspace-context.js";
import { bracketOutput, cleanBracket, winsRequired } from "./bracket.js";
import BracketScreen from "./BracketScreen.jsx";
import "./BracketStudio.css";

// Shared with the tournament creation form; this factory contains no React state.
// eslint-disable-next-line react-refresh/only-export-components
export const blankEntrant = () => ({
  id: crypto.randomUUID(),
  name: "",
  tag: "",
  logo: null,
  players: [],
});

const playerRecord = (player = {}) => ({
  id: player.id || crypto.randomUUID(),
  name: player.name || "",
  steamId: player.steamId || "",
});

export function EntrantEditor({
  entrants,
  onChange,
  library = {},
  disabled = false,
  maximum = 32,
}) {
  const teams = library.teams || [];
  const players = library.players || [];
  const update = (index, changes) =>
    onChange(
      entrants.map((team, at) =>
        at === index ? { ...team, ...changes } : team,
      ),
    );
  const move = (index, offset) => {
    const next = [...entrants];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    onChange(next);
  };
  const updatePlayer = (teamIndex, slot, changes) => {
    const roster = Array.from(
      { length: 6 },
      (_, index) => entrants[teamIndex].players?.[index] || {},
    );
    roster[slot] = { ...playerRecord(roster[slot]), ...changes };
    update(teamIndex, { players: roster });
  };
  return (
    <fieldset className="brk-entrant-editor" disabled={disabled}>
      <div className="brk-entrant-toolbar">
        {maximum > 1 && (
          <label>
            Add a saved team
            <select
              aria-label="Add saved team"
              value=""
              onChange={(event) => {
                const team = teams.find(
                  (item) => item.id === event.target.value,
                );
                if (!team || entrants.some((item) => item.id === team.id))
                  return;
                const roster =
                  team.playerIds
                    ?.map((id) => players.find((player) => player.id === id))
                    .filter(Boolean) ||
                  team.players ||
                  [];
                onChange([
                  ...entrants,
                  {
                    id: team.id,
                    name: team.name,
                    tag: team.tag || "",
                    logo: team.logo || null,
                    players: roster.map(playerRecord),
                  },
                ]);
              }}
              disabled={disabled || entrants.length >= maximum}
            >
              <option value="">Choose from your team library…</option>
              {teams
                .filter((team) => !entrants.some((item) => item.id === team.id))
                .map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
            </select>
          </label>
        )}
        <button
          type="button"
          className="button secondary"
          disabled={disabled || entrants.length >= maximum}
          onClick={() => onChange([...entrants, blankEntrant()])}
        >
          + Add team
        </button>
        <span>
          {entrants.length} / {maximum} teams
        </span>
      </div>
      {!entrants.length && (
        <div className="brk-empty-entrants">
          <strong>Start with your teams</strong>
          <p>
            Add teams here or choose ones you have saved. Player details are
            optional.
          </p>
        </div>
      )}
      <div className="brk-entrant-list">
        {entrants.map((team, index) => (
          <article className="brk-entrant" key={team.id}>
            <div className="brk-entrant-main">
              <span className="brk-seed" title="Seed and manual draw position">
                {index + 1}
              </span>
              <label className="brk-team-name-label">
                Team name
                <input
                  aria-label={`Team ${index + 1} name`}
                  value={team.name}
                  maxLength={64}
                  placeholder="Team name"
                  onChange={(event) =>
                    update(index, { name: event.target.value })
                  }
                />
              </label>
              <label className="brk-tag-label">
                Short tag
                <input
                  aria-label={`Team ${index + 1} tag`}
                  value={team.tag || ""}
                  maxLength={12}
                  placeholder="TAG"
                  onChange={(event) =>
                    update(index, { tag: event.target.value })
                  }
                />
              </label>
              <div className="brk-order-buttons">
                <button
                  type="button"
                  aria-label={`Move team ${index + 1} up`}
                  disabled={disabled || index === 0}
                  onClick={() => move(index, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`Move team ${index + 1} down`}
                  disabled={disabled || index === entrants.length - 1}
                  onClick={() => move(index, 1)}
                >
                  ↓
                </button>
              </div>
              <button
                type="button"
                className="brk-text-button"
                aria-label={`Remove team ${index + 1}`}
                onClick={() =>
                  onChange(entrants.filter((_, at) => at !== index))
                }
              >
                Remove
              </button>
            </div>
            <details className="brk-player-details">
              <summary>
                Players{" "}
                <span>
                  optional ·{" "}
                  {team.players?.filter(
                    (player) => player.name || player.steamId,
                  ).length || 0}{" "}
                  of 6
                </span>
              </summary>
              <p>
                Keep names and Steam accounts together for future broadcasts.
                Use a SteamID64, numeric account ID, or a Steam profile link.
              </p>
              <div className="brk-player-grid">
                {Array.from({ length: 6 }, (_, slot) => {
                  const player = team.players?.[slot] || {};
                  return (
                    <div className="brk-player-edit" key={slot}>
                      <span>{slot + 1}</span>
                      <label>
                        Player name
                        <input
                          aria-label={`Team ${index + 1} player ${slot + 1} name`}
                          maxLength={64}
                          value={player.name || ""}
                          placeholder="Player name"
                          onChange={(event) =>
                            updatePlayer(index, slot, {
                              name: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        Steam account
                        <input
                          aria-label={`Team ${index + 1} player ${slot + 1} Steam account`}
                          maxLength={200}
                          value={player.steamId || ""}
                          placeholder="SteamID or profile link"
                          onChange={(event) =>
                            updatePlayer(index, slot, {
                              steamId: event.target.value,
                            })
                          }
                        />
                      </label>
                      {!!players.length && (
                        <label className="brk-saved-player-label">
                          Use saved player
                          <select
                            aria-label={`Team ${index + 1} player ${slot + 1} saved player`}
                            value=""
                            onChange={(event) => {
                              const saved = players.find(
                                (item) => item.id === event.target.value,
                              );
                              if (saved)
                                updatePlayer(index, slot, playerRecord(saved));
                            }}
                          >
                            <option value="">Choose player…</option>
                            {players.map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.name || item.steamId}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                    </div>
                  );
                })}
              </div>
            </details>
          </article>
        ))}
      </div>
      {!!entrants.length && maximum > 1 && (
        <p className="brk-help">
          Use the arrows to set seeds. In manual pairings, positions 1–2 play
          each other, then 3–4, and so on.
        </p>
      )}
    </fieldset>
  );
}

function MatchEditor({
  match,
  seriesFormat,
  activeMatchId,
  disabled,
  onAction,
}) {
  const [scores, setScores] = useState(match.scores || [0, 0]);
  const [winner, setWinner] = useState(match.winnerId || "");
  const ready = match.teams?.every(Boolean) && match.status !== "bye";
  const required = winsRequired(seriesFormat);
  const chooseWinner = (id) => {
    setWinner(id);
    if (!id) return;
    const side = match.teams.findIndex((team) => team.id === id);
    setScores(
      scores.map((score, at) =>
        at === side ? required : Math.min(score, required - 1),
      ),
    );
  };
  return (
    <article
      className={`brk-match-editor${activeMatchId === match.id ? " is-prepared" : ""}`}
      data-match-id={match.id}
    >
      <div className="brk-match-editor-top">
        <span>
          Match{" "}
          {match.index != null
            ? match.index + 1
            : match.id.split("-m")[1] || ""}
        </span>
        <span className={`brk-match-status is-${match.status}`}>
          {activeMatchId === match.id
            ? "Selected for broadcast"
            : match.status === "bye"
              ? "Bye · advanced"
              : match.status === "complete"
                ? "Complete"
                : match.status === "ready"
                  ? "Ready to play"
                  : "Waiting for teams"}
        </span>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onAction(
            "bracket/result",
            {
              matchId: match.id,
              scores,
              ...(winner ? { winnerId: winner } : {}),
            },
            "Match result saved.",
          );
        }}
      >
        {[0, 1].map((side) => (
          <label className="brk-match-score" key={side}>
            <span>
              {match.teams?.[side]?.name ||
                (match.status === "bye" ? "Bye" : "Winner of an earlier match")}
            </span>
            <input
              type="number"
              aria-label={`${match.id} ${side === 0 ? "left" : "right"} score`}
              min={0}
              max={required}
              step={1}
              value={scores[side]}
              disabled={disabled || !ready}
              onChange={(event) => {
                setWinner("");
                setScores(
                  scores.map((score, at) =>
                    at === side
                      ? Math.max(0, Number(event.target.value) || 0)
                      : score,
                  ),
                );
              }}
            />
          </label>
        ))}
        {ready && (
          <details className="brk-result-details">
            <summary>Enter or correct result</summary>
            <label>
              Winner
              <select
                aria-label={`${match.id} winner`}
                value={winner}
                disabled={disabled}
                onChange={(event) => chooseWinner(event.target.value)}
              >
                <option value="">Decide from series score</option>
                {match.teams.map((team) => (
                  <option value={team.id} key={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="brk-match-actions">
              <button className="button primary" disabled={disabled}>
                Save score / result
              </button>
              <button
                type="button"
                className="brk-text-button"
                disabled={
                  disabled || (!match.winnerId && !match.scores?.some(Boolean))
                }
                onClick={() =>
                  onAction(
                    "bracket/clear-result",
                    { matchId: match.id },
                    "Result cleared. Later affected matches were reset.",
                  )
                }
              >
                Clear result
              </button>
            </div>
          </details>
        )}
      </form>
      {ready && match.status !== "complete" && (
        <button
          className="button secondary brk-prepare-button"
          disabled={disabled || activeMatchId === match.id}
          onClick={() =>
            onAction(
              "bracket/prepare",
              { matchId: match.id },
              "Match selected. Team names and scores are ready in the broadcast controls.",
            )
          }
        >
          {activeMatchId === match.id
            ? "Ready in broadcast controls"
            : "Use this match on broadcast"}
        </button>
      )}
    </article>
  );
}

export default function BracketStudio({ active }) {
  const shared = useWorkspace();
  const state = cleanBracket(shared?.data?.bracket);
  const publicView = bracketOutput(state, {
    title: shared?.data?.config?.event,
  });
  const [draft, setDraft] = useState(null);
  const draftRevision = useRef(null);
  const [library, setLibrary] = useState({ teams: [], players: [] });
  const [libraryRefresh, setLibraryRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [saveToLibrary, setSaveToLibrary] = useState(false);
  const [seeding, setSeeding] = useState(state.seeding || "seeded");
  const [seriesFormat, setSeriesFormat] = useState(state.seriesFormat || "BO3");
  const [replace, setReplace] = useState(false);
  const [replaceEntrants, setReplaceEntrants] = useState(false);
  const [scale, setScale] = useState(0.5);
  const preview = useRef(null);
  const entrants = draft || state.entrants;
  const dirty =
    draft !== null && JSON.stringify(draft) !== JSON.stringify(state.entrants);
  const disabled =
    busy ||
    Boolean(shared?.readOnly || shared?.changingTournament || shared?.saving);
  const outputUrl = new URL("/obs/bracket", window.location.origin).href;
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
  async function action(path, value = {}, message = "Saved.") {
    if (disabled) return;
    setBusy(true);
    setNotice("");
    try {
      await shared.command(path, {
        ...value,
        expectedRevision:
          path === "bracket/entrants" && draftRevision.current !== null
            ? draftRevision.current
            : state.revision,
      });
      if (path === "bracket/entrants") {
        setDraft(null);
        draftRevision.current = null;
        setLibraryRefresh((current) => current + 1);
      }
      setReplace(false);
      setReplaceEntrants(false);
      setNotice(message);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }
  const editEntrants = (value) => {
    if (draftRevision.current === null) draftRevision.current = state.revision;
    setDraft(value);
    setReplace(false);
  };
  const generate = () =>
    action(
      "bracket/generate",
      { seeding, seriesFormat, resetConfirmed: replace },
      "Bracket generated. Choose the first match to prepare the broadcast.",
    );
  const saveEntrants = (resetConfirmed = false) =>
    action(
      "bracket/entrants",
      { entrants, saveToLibrary, resetConfirmed },
      saveToLibrary
        ? "Teams and players saved, including reusable library records."
        : "Tournament teams saved.",
    );
  return (
    <section className="bracket-studio" hidden={!active}>
      <div className="page-heading">
        <div>
          <span className="eyebrow">FROM THE FIRST DRAW TO THE FINAL</span>
          <h1>
            Tournament bracket<span>✦</span>
          </h1>
          <p>
            Bring in your teams, draw the matchups, and follow every result in
            one place.
          </p>
        </div>
        <span className={`brk-live-state${state.visible ? "" : " is-hidden"}`}>
          {state.visible ? "Visible in OBS" : "Hidden in OBS"}
        </span>
      </div>
      {notice && (
        <p className="brk-notice" role="status">
          {notice}
        </p>
      )}
      <section className="brk-card">
        <div className="brk-card-head">
          <div>
            <h2>Bracket preview</h2>
            <p>
              {state.matches.length
                ? `${state.entrants.length} teams · Single elimination · ${state.seriesFormat}`
                : "Your generated bracket will appear here."}
            </p>
          </div>
          <button
            className="button secondary"
            disabled={disabled}
            onClick={() =>
              action(
                "bracket/settings",
                { visible: !state.visible },
                state.visible
                  ? "Bracket hidden in OBS."
                  : "Bracket visible in OBS.",
              )
            }
          >
            {state.visible ? "Hide bracket" : "Show bracket"}
          </button>
        </div>
        <div
          className="brk-preview"
          ref={preview}
          style={{ height: 1080 * scale }}
        >
          <div
            className="brk-preview-stage"
            style={{ transform: `scale(${scale})` }}
          >
            <BracketScreen bracket={{ ...publicView, visible: true }} />
          </div>
          {!state.visible && (
            <span className="brk-preview-hidden">Preview · hidden in OBS</span>
          )}
        </div>
        <div className="brk-preview-footer">
          <span>1920 × 1080 source · updates automatically</span>
          <label className="brk-switch">
            <input
              type="checkbox"
              checked={state.transparent}
              disabled={disabled}
              onChange={(event) =>
                action("bracket/settings", {
                  transparent: event.target.checked,
                })
              }
            />
            Transparent background
          </label>
        </div>
      </section>
      <section className="brk-card brk-source">
        <div>
          <h2>Permanent OBS source</h2>
          <p>
            Add this as a Browser Source at 1920 × 1080. It always shows the
            selected tournament.
          </p>
        </div>
        <div className="brk-source-row">
          <input
            aria-label="Bracket permanent OBS URL"
            value={outputUrl}
            readOnly
            onFocus={(event) => event.target.select()}
          />
          <button
            className="button primary"
            onClick={() =>
              navigator.clipboard
                .writeText(outputUrl)
                .then(() => setNotice("Bracket URL copied."))
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
      <section className="brk-card">
        <div className="brk-card-head">
          <div>
            <h2>Teams & players</h2>
            <p>
              Set the order for seeded or manual pairings. A single-elimination
              bracket supports 2–32 teams.
            </p>
          </div>
          <span className="brk-step">01 / THE TEAMS</span>
        </div>
        <EntrantEditor
          entrants={entrants}
          onChange={editEntrants}
          library={library}
          disabled={disabled}
        />
        <div className="brk-entrant-save">
          <label className="brk-switch">
            <input
              type="checkbox"
              checked={saveToLibrary}
              disabled={disabled}
              onChange={(event) => setSaveToLibrary(event.target.checked)}
            />
            Save these teams and players to the library for later
          </label>
          <div className="brk-inline-actions">
            {dirty && (
              <button
                className="brk-text-button"
                disabled={disabled}
                onClick={() => {
                  setDraft(null);
                  draftRevision.current = null;
                  setReplaceEntrants(false);
                }}
              >
                Discard edits
              </button>
            )}
            <button
              className="button primary"
              disabled={disabled || !dirty}
              onClick={() =>
                state.matches.length ? setReplaceEntrants(true) : saveEntrants()
              }
            >
              Save teams
            </button>
          </div>
        </div>
        {dirty && (
          <p className="brk-help">
            Save your team changes before generating the bracket.
          </p>
        )}
        {!!state.matches.length && (
          <p className="brk-help">
            Changing the team list requires a new draw. Keep the current list if
            matches are already under way.
          </p>
        )}
        {replaceEntrants && (
          <div className="brk-replace-confirm">
            <p>
              Saving these changes clears the current draw and its results. You
              can generate a new bracket from the updated teams.
            </p>
            <button
              className="button primary"
              disabled={disabled}
              onClick={() => saveEntrants(true)}
            >
              Save teams and clear bracket
            </button>
            <button
              className="button secondary"
              disabled={disabled}
              onClick={() => setReplaceEntrants(false)}
            >
              Keep current bracket
            </button>
          </div>
        )}
      </section>
      <section className="brk-card">
        <div className="brk-card-head">
          <div>
            <h2>Generate the bracket</h2>
            <p>
              Odd-sized fields get automatic byes. The same team keeps its
              details throughout the tournament.
            </p>
          </div>
          <span className="brk-step">02 / THE DRAW</span>
        </div>
        <div className="brk-generate-grid">
          <label>
            Draw method
            <select
              aria-label="Bracket draw method"
              value={seeding}
              disabled={disabled}
              onChange={(event) => setSeeding(event.target.value)}
            >
              <option value="seeded">By seed · keep top seeds apart</option>
              <option value="random">Random draw</option>
              <option value="manual">Manual pairings · use team order</option>
            </select>
          </label>
          <label>
            Match series
            <select
              aria-label="Bracket match series"
              value={seriesFormat}
              disabled={disabled}
              onChange={(event) => setSeriesFormat(event.target.value)}
            >
              <option value="BO1">Best of 1</option>
              <option value="BO3">Best of 3</option>
              <option value="BO5">Best of 5</option>
              <option value="BO7">Best of 7</option>
            </select>
          </label>
          <button
            className="button primary"
            disabled={disabled || dirty || state.entrants.length < 2}
            onClick={() =>
              state.matches.length ? setReplace(true) : generate()
            }
          >
            {state.matches.length ? "Create a new draw" : "Generate bracket"}
          </button>
        </div>
        {replace && (
          <div className="brk-replace-confirm">
            <p>
              This replaces the current draw and clears its match results. Saved
              team and player records are kept.
            </p>
            <button
              className="button primary"
              disabled={disabled || dirty}
              onClick={generate}
            >
              Replace bracket
            </button>
            <button
              className="button secondary"
              disabled={disabled}
              onClick={() => setReplace(false)}
            >
              Keep current bracket
            </button>
          </div>
        )}
      </section>
      {!!state.matches.length && (
        <section className="brk-card">
          <div className="brk-card-head">
            <div>
              <h2>Matches & results</h2>
              <p>
                Select the match being broadcast, then publish confirmed game
                results from Live desk. Series winners advance when they reach
                the required wins.
              </p>
            </div>
            <span className="brk-step">03 / THE MATCHES</span>
          </div>
          <label className="brk-switch">
            <input
              type="checkbox"
              checked={state.autoResults}
              disabled={disabled}
              onChange={(event) =>
                action("bracket/settings", {
                  autoResults: event.target.checked,
                })
              }
            />
            Follow confirmed published match results
          </label>
          <p className="brk-help">
            Overlay score boxes are display controls. They do not decide a
            bracket winner. You can also enter a score or winner manually below.
          </p>
          {state.lastSync?.message && (
            <p className="brk-sync-note" role="status">
              {state.lastSync.message}
            </p>
          )}
          <p className="brk-correction-note">
            Correcting an earlier winner resets affected later matches so the
            bracket stays consistent.
          </p>
          <div className="brk-round-editors">
            {publicView.rounds.map((round) => (
              <section className="brk-round-editor" key={round.id}>
                <h3>{round.name}</h3>
                <div>
                  {round.matches.map((match) => (
                    <MatchEditor
                      key={`${match.id}:${match.teams.map((team) => team?.id || "").join(":")}:${state.seriesFormat}:${match.scores?.join(":")}:${match.winnerId || ""}`}
                      match={match}
                      seriesFormat={state.seriesFormat}
                      activeMatchId={state.activeMatchId}
                      disabled={disabled}
                      onAction={action}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </section>
      )}
    </section>
  );
}

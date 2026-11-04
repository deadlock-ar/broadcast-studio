import { useEffect, useState } from "react";
import { EntrantEditor, blankEntrant } from "./BracketStudio.jsx";
import { useWorkspace, workspaceRequest } from "./workspace-context.js";
import "./RosterLibraryPanel.css";

export default function RosterLibraryPanel({ active = true }) {
  const shared = useWorkspace();
  const [library, setLibrary] = useState({ teams: [], players: [] });
  const [kind, setKind] = useState("teams");
  const [search, setSearch] = useState("");
  const [team, setTeam] = useState(blankEntrant);
  const [player, setPlayer] = useState({ name: "", steamId: "" });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);
  const disabled =
    busy || Boolean(shared?.readOnly || shared?.changingTournament);
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
  }, [active, refresh]);
  async function save(path, value, message) {
    if (disabled) return;
    setBusy(true);
    setNotice("");
    try {
      await workspaceRequest(path, value);
      setLibrary(await workspaceRequest("roster-library"));
      if (path.endsWith("/team")) setTeam(blankEntrant());
      else setPlayer({ name: "", steamId: "" });
      setNotice(message);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }
  const editTeam = (saved) =>
    setTeam({
      ...saved,
      players: saved.playerIds
        .map((id) => library.players.find((item) => item.id === id))
        .filter(Boolean)
        .map((item) => ({ ...item })),
    });
  const query = search.toLocaleLowerCase().trim();
  const rows = (kind === "teams" ? library.teams : library.players).filter(
    (record) =>
      `${record.name} ${record.tag || ""} ${record.steamId || ""}`
        .toLocaleLowerCase()
        .includes(query),
  );
  const teamIsSaved = library.teams.some((item) => item.id === team.id);
  return (
    <section className="roster-library-panel" hidden={!active}>
      <div className="rl-heading">
        <div>
          <h2>Teams & players</h2>
          <p>
            A shared address book for every tournament. Save a player on their
            own or keep a whole team roster together.
          </p>
        </div>
        <button
          className="button secondary"
          disabled={disabled}
          onClick={() => setRefresh((value) => value + 1)}
        >
          Refresh library
        </button>
      </div>
      {notice && (
        <p className="rl-notice" role="status">
          {notice}
        </p>
      )}
      <div className="rl-kind-tabs">
        <button
          className={kind === "teams" ? "is-active" : ""}
          onClick={() => {
            setKind("teams");
            setSearch("");
          }}
        >
          Teams <span>{library.teams.length}</span>
        </button>
        <button
          className={kind === "players" ? "is-active" : ""}
          onClick={() => {
            setKind("players");
            setSearch("");
          }}
        >
          Players <span>{library.players.length}</span>
        </button>
      </div>
      <div className="rl-layout">
        <section className="rl-card">
          <label className="rl-search-label">
            Search saved {kind}
            <input
              aria-label={`Search saved ${kind}`}
              type="search"
              value={search}
              placeholder={
                kind === "teams"
                  ? "Search team names…"
                  : "Search names or Steam accounts…"
              }
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <div className="rl-record-list">
            {rows.length ? (
              rows.map((record) => (
                <article key={record.id}>
                  <span className="rl-record-mark">
                    {record.tag || record.name?.slice(0, 2)}
                  </span>
                  <div>
                    <strong>{record.name}</strong>
                    <small>
                      {kind === "teams"
                        ? `${record.playerIds.length} saved players${record.tag ? ` · ${record.tag}` : ""}`
                        : record.steamId || "No Steam account saved"}
                    </small>
                  </div>
                  <button
                    className="rl-text-button"
                    aria-label={`Edit ${record.name}`}
                    disabled={disabled}
                    onClick={() =>
                      kind === "teams"
                        ? editTeam(record)
                        : setPlayer({ ...record })
                    }
                  >
                    Edit
                  </button>
                </article>
              ))
            ) : (
              <div className="rl-empty">
                <strong>
                  {query ? "No matching records" : `No saved ${kind} yet`}
                </strong>
                <p>
                  {query
                    ? "Try another name or Steam account."
                    : "Add one here, or save a tournament roster to use it again later."}
                </p>
              </div>
            )}
          </div>
        </section>
        {kind === "players" ? (
          <section className="rl-card">
            <h3>{player.id ? "Edit saved player" : "Add a player"}</h3>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                save(
                  "roster-library/player",
                  { ...player, updateExisting: true },
                  "Player saved. You can reuse this account in any tournament.",
                );
              }}
            >
              <fieldset disabled={disabled}>
                <label>
                  Player name
                  <input
                    aria-label="Saved player name"
                    required
                    maxLength={80}
                    value={player.name}
                    placeholder="Display name"
                    onChange={(event) =>
                      setPlayer({ ...player, name: event.target.value })
                    }
                  />
                </label>
                <label>
                  Steam account
                  <input
                    aria-label="Saved player Steam account"
                    maxLength={200}
                    value={player.steamId}
                    placeholder="SteamID64, account ID, or profile link"
                    onChange={(event) =>
                      setPlayer({ ...player, steamId: event.target.value })
                    }
                  />
                </label>
                <p>
                  Use a numeric SteamID or a steamcommunity.com/profiles link.
                  Steam accounts are stored once, so you can reuse them without
                  asking again.
                </p>
                <div className="rl-form-actions">
                  <button
                    className="button primary"
                    disabled={disabled || !player.name.trim()}
                  >
                    Save player
                  </button>
                  <button
                    type="button"
                    className="rl-text-button"
                    onClick={() => setPlayer({ name: "", steamId: "" })}
                  >
                    Clear form
                  </button>
                </div>
              </fieldset>
            </form>
          </section>
        ) : (
          <section className="rl-card rl-team-form">
            <h3>{teamIsSaved ? "Edit saved team" : "Add a team"}</h3>
            <EntrantEditor
              entrants={[team]}
              onChange={(entrants) => setTeam(entrants[0] || blankEntrant())}
              library={library}
              disabled={disabled}
              maximum={1}
            />
            <p>
              Saving this roster also saves its players as individual records.
              Editing a saved team updates the library; tournament draws keep
              their own team details.
            </p>
            <div className="rl-form-actions">
              <button
                className="button primary"
                disabled={disabled || !team.name.trim()}
                onClick={() =>
                  save(
                    "roster-library/team",
                    {
                      ...team,
                      id: teamIsSaved ? team.id : undefined,
                      players: (team.players || [])
                        .filter(
                          (item) => item.name?.trim() || item.steamId?.trim(),
                        )
                        .map((item) => ({
                          ...item,
                          id: library.players.some(
                            (saved) => saved.id === item.id,
                          )
                            ? item.id
                            : undefined,
                        })),
                      savePlayers: true,
                      updateExisting: true,
                    },
                    "Team and player records saved for future tournaments.",
                  )
                }
              >
                Save team
              </button>
              <button
                className="rl-text-button"
                disabled={disabled}
                onClick={() => setTeam(blankEntrant())}
              >
                Clear form
              </button>
            </div>
          </section>
        )}
      </div>
    </section>
  );
}

import { useState, useRef, useEffect } from "react";
import { useWorkspace, workspaceRequest } from "./workspace-context.js";
import { EntrantEditor } from "./BracketStudio.jsx";
export default function TournamentSwitcher() {
  const shared = useWorkspace(),
    [name, setName] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [open, setOpen] = useState(false),
    [entrants, setEntrants] = useState([]),
    [library, setLibrary] = useState({ teams: [], players: [] }),
    [saveToLibrary, setSaveToLibrary] = useState(false),
    [generate, setGenerate] = useState(true),
    [seeding, setSeeding] = useState("seeded"),
    [seriesFormat, setSeriesFormat] = useState("BO3");
  const form = useRef(null);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    workspaceRequest("roster-library")
      .then((value) => {
        if (alive) setLibrary(value);
      })
      .catch((error) => {
        if (alive) setNotice(error.message);
      });
    return () => {
      alive = false;
    };
  }, [open]);
  async function run(path, value) {
    setBusy(true);
    setNotice("");
    try {
      await shared.command(path, value);
      setName("");
      setEntrants([]);
      if (form.current) form.current.open = false;
    } catch (e) {
      setNotice(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="tournament-switcher" aria-label="Tournament selection">
      <label>
        Current tournament
        <select
          aria-label="Current tournament"
          value={shared.data.activeTournamentId || ""}
          disabled={busy || shared.saving}
          onChange={(e) => run("tournaments/select", { id: e.target.value })}
        >
          {(shared.data.tournaments || []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <details
        ref={form}
        className="tournament-create"
        onToggle={(event) => setOpen(event.currentTarget.open)}
      >
        <summary>+ New tournament</summary>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run("tournaments/create", {
              name,
              entrants,
              saveToLibrary,
              generate: generate && entrants.length >= 2,
              seeding,
              seriesFormat,
            });
          }}
        >
          <fieldset
            disabled={busy || shared.saving || shared.changingTournament}
          >
            <label>
              Tournament name
              <input
                required
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <div className="tournament-create-rosters">
              <h3>Teams & players</h3>
              <p>
                Add teams now, or add them later in the Bracket tab. Player
                names and Steam IDs are optional.
              </p>
              <EntrantEditor
                entrants={entrants}
                onChange={setEntrants}
                library={library}
                disabled={busy || shared.saving}
              />
            </div>
            <label className="tournament-create-check">
              <input
                type="checkbox"
                checked={saveToLibrary}
                onChange={(event) => setSaveToLibrary(event.target.checked)}
              />
              Save these teams and players for later tournaments
            </label>
            <div className="tournament-create-options">
              <label>
                Match format
                <select
                  aria-label="New tournament match format"
                  value={seriesFormat}
                  onChange={(event) => setSeriesFormat(event.target.value)}
                >
                  {["BO1", "BO3", "BO5", "BO7"].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
              <label>
                Bracket placement
                <select
                  aria-label="New tournament bracket placement"
                  value={seeding}
                  onChange={(event) => setSeeding(event.target.value)}
                >
                  <option value="seeded">Seeded — strongest seeds apart</option>
                  <option value="random">Random draw</option>
                  <option value="manual">Manual — pair adjacent teams</option>
                </select>
              </label>
            </div>
            <label className="tournament-create-check">
              <input
                type="checkbox"
                checked={generate}
                onChange={(event) => setGenerate(event.target.checked)}
              />
              Generate a single-elimination bracket when at least two teams are
              entered
            </label>
            <button className="button primary" disabled={busy || shared.saving}>
              Create & select
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => {
                if (form.current) form.current.open = false;
              }}
            >
              Cancel
            </button>
          </fieldset>
        </form>
      </details>
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}

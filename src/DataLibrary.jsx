import { useEffect, useState } from "react";
import { useWorkspace, workspaceRequest } from "./workspace-context.js";
import BackupControls from "./BackupControls.jsx";
import RosterLibraryPanel from "./RosterLibraryPanel.jsx";
export default function DataLibrary({ active }) {
  const shared = useWorkspace(),
    [data, setData] = useState({
      tournaments: [],
      games: [],
      drafts: [],
      trash: [],
    }),
    [kind, setKind] = useState("game"),
    [scope, setScope] = useState("current"),
    [selected, setSelected] = useState([]),
    [notice, setNotice] = useState(""),
    [pending, setPending] = useState(null),
    [confirmation, setConfirmation] = useState(""),
    [busy, setBusy] = useState(false),
    [rename, setRename] = useState(null);
  const current = shared.data.activeTournamentId;
  useEffect(() => {
    if (!active) return;
    let live = true;
    workspaceRequest("data")
      .then((x) => {
        if (live) setData(x);
      })
      .catch((e) => {
        if (live) setNotice(e.message);
      });
    return () => {
      live = false;
    };
  }, [active, current, shared.data.revision]);
  const name = (id) =>
    data.tournaments.find((t) => t.id === id)?.name || "Deleted tournament";
  const rows =
    kind === "tournament"
      ? data.tournaments
      : kind === "trash"
        ? data.trash
        : (kind === "game" ? data.games : data.drafts).filter(
            (r) => scope === "all" || r.tournamentId === current,
          );
  async function action(path, value) {
    setBusy(true);
    setNotice("");
    try {
      await workspaceRequest(path, value);
      setData(await workspaceRequest("data"));
      setSelected([]);
      setPending(null);
      setConfirmation("");
      setRename(null);
      setNotice("Saved.");
    } catch (e) {
      setNotice(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="data-library" hidden={!active}>
      <div className="page-heading">
        <div>
          <span className="eyebrow">ARCHIVES / RECOVERY</span>
          <h1>
            Data library<span>✦</span>
          </h1>
          <p>
            Manage tournaments, teams, players, saved games, drafts and backups.
          </p>
        </div>
      </div>
      <div className="production-tabs">
        {[
          ["game", "Games"],
          ["draft", "Drafts"],
          ["tournament", "Tournaments"],
          ["rosters", "Teams & players"],
          ["trash", "Trash"],
          ["backup", "Backups"],
        ].map(([id, label]) => (
          <button
            key={id}
            className={kind === id ? "selected" : ""}
            onClick={() => {
              setKind(id);
              setSelected([]);
              setPending(null);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {notice && (
        <p className="production-notice" role="status">
          {notice}
        </p>
      )}
      {kind === "rosters" ? (
        <RosterLibraryPanel active={active} />
      ) : kind === "backup" ? (
        <BackupControls allowDelete />
      ) : (
        <>
          <div className="data-toolbar">
            {["game", "draft"].includes(kind) && (
              <label>
                Show
                <select
                  value={scope}
                  onChange={(e) => {
                    setScope(e.target.value);
                    setSelected([]);
                  }}
                >
                  <option value="current">Current tournament</option>
                  <option value="all">All tournaments</option>
                </select>
              </label>
            )}
            {["game", "draft", "tournament"].includes(kind) && (
              <button
                className="button secondary"
                disabled={!selected.length || busy}
                onClick={() =>
                  setPending({ action: "trash", kind, ids: selected })
                }
              >
                Delete selected ({selected.length})
              </button>
            )}
            <small>
              {rows.length}{" "}
              {kind === "game"
                ? "games"
                : kind === "draft"
                  ? "drafts"
                  : kind === "trash"
                    ? "deleted records"
                    : "tournaments"}
            </small>
          </div>
          <div className="production-card data-table">
            <table>
              <thead>
                <tr>
                  <th>
                    {kind !== "trash" && (
                      <input
                        aria-label="Select all records"
                        type="checkbox"
                        checked={
                          rows.some((r) => !r.active) &&
                          rows
                            .filter((r) => !r.active)
                            .every((r) => selected.includes(r.id))
                        }
                        onChange={(e) =>
                          setSelected(
                            e.target.checked
                              ? rows.filter((r) => !r.active).map((r) => r.id)
                              : [],
                          )
                        }
                      />
                    )}
                  </th>
                  <th>Name</th>
                  <th>Tournament / status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {kind !== "trash" && (
                        <input
                          type="checkbox"
                          aria-label={`Select ${r.label || r.name}`}
                          disabled={r.active}
                          checked={selected.includes(r.id)}
                          onChange={(e) =>
                            setSelected((old) =>
                              e.target.checked
                                ? [...old, r.id]
                                : old.filter((id) => id !== r.id),
                            )
                          }
                        />
                      )}
                    </td>
                    <td>
                      <strong>{r.label || r.name}</strong>
                      <small>{r.id}</small>
                    </td>
                    <td>
                      {kind === "tournament"
                        ? r.active
                          ? "Current tournament"
                          : `${data.games.filter((g) => g.tournamentId === r.id).length} games · ${data.drafts.filter((d) => d.tournamentId === r.id).length} drafts`
                        : `${name(r.tournamentId)} · ${kind === "trash" ? r.kind : r.status || `${r.selections} selections`}`}
                      {r.published && <small>Published scoreboard</small>}
                    </td>
                    <td>
                      {kind === "trash" ? (
                        <>
                          <button
                            className="text-button"
                            disabled={busy}
                            onClick={() => action("data/restore", { id: r.id })}
                          >
                            Restore
                          </button>
                          <button
                            className="text-button danger"
                            onClick={() => {
                              setPending({
                                action: "purge",
                                id: r.id,
                                label: r.label,
                              });
                              setConfirmation("");
                            }}
                          >
                            Permanently delete
                          </button>
                        </>
                      ) : kind === "tournament" ? (
                        <button
                          className="text-button"
                          onClick={() => setRename({ id: r.id, name: r.name })}
                        >
                          Rename
                        </button>
                      ) : (
                        <button
                          className="text-button danger"
                          onClick={() =>
                            setPending({ action: "trash", kind, ids: [r.id] })
                          }
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows.length && <p className="data-empty">Nothing here yet.</p>}
          </div>
          {kind === "trash" && (
            <p className="production-hint">
              Restoring a record keeps its data but does not put it back on air.
              Permanent deletion removes it from this library; separate backup
              copies may still contain it.
            </p>
          )}
          {pending && (
            <section
              className="production-card data-confirm"
              role="dialog"
              aria-label="Confirm deletion"
            >
              <h2>
                {pending.action === "purge"
                  ? "Permanently delete this record?"
                  : "Move selected records to Trash?"}
              </h2>
              <p>
                {pending.action === "purge"
                  ? "This cannot be undone from the library. Type DELETE to continue."
                  : "Games include their statistics, items and saved scoreboard. Tournaments include their games and drafts. Selected records will leave reports and OBS outputs, and can be restored from Trash. Series scores are not recalculated."}
              </p>
              {pending.action === "purge" && (
                <input
                  aria-label="Type DELETE"
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                />
              )}
              <button
                className="button primary"
                disabled={
                  busy ||
                  (pending.action === "purge" && confirmation !== "DELETE")
                }
                onClick={() =>
                  action(`data/${pending.action}`, { ...pending, confirmation })
                }
              >
                {pending.action === "purge"
                  ? "Permanently delete"
                  : "Move to Trash"}
              </button>
              <button
                className="button secondary"
                onClick={() => setPending(null)}
              >
                Cancel
              </button>
            </section>
          )}
          {rename && (
            <form
              className="production-card data-confirm"
              onSubmit={(e) => {
                e.preventDefault();
                action("tournaments/rename", rename);
              }}
            >
              <label>
                Tournament name
                <input
                  value={rename.name}
                  required
                  maxLength={120}
                  onChange={(e) =>
                    setRename({ ...rename, name: e.target.value })
                  }
                />
              </label>
              <button className="button primary" disabled={busy}>
                Save name
              </button>
              <button
                type="button"
                className="button secondary"
                onClick={() => setRename(null)}
              >
                Cancel
              </button>
            </form>
          )}
        </>
      )}
    </section>
  );
}

import { useEffect, useState } from "react";
import { workspaceRequest } from "./workspace-context.js";
export default function BackupControls({ allowDelete = false }) {
  const [deleting, setDeleting] = useState(""),
    [confirmation, setConfirmation] = useState("");
  const [files, setFiles] = useState([]),
    [pending, setPending] = useState(null),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    workspaceRequest("backups")
      .then((v) => {
        if (alive) setFiles(v.files);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  async function read(file) {
    try {
      if (!file) return;
      if (file.size > 64000000)
        throw Error("Choose a backup smaller than 64 MB.");
      const text = file.name.endsWith(".gz")
        ? await new Response(
            file.stream().pipeThrough(new DecompressionStream("gzip")),
          ).text()
        : await file.text();
      const value = JSON.parse(text);
      if (
        ![1, 2].includes(value.version) ||
        !Array.isArray(value.matches) ||
        !value.workspace
      )
        throw Error("Unsupported studio backup.");
      setPending(value);
      setNotice("");
    } catch (e) {
      setPending(null);
      setNotice(e.message);
    }
  }
  async function restore() {
    setBusy(true);
    try {
      await workspaceRequest("backup/restore", pending);
      window.location.reload();
    } catch (e) {
      setNotice(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="production-card backup-controls">
      <h2>Saved results and backups</h2>
      <p>
        The Railway volume holds the shared workspace, drafts, purchase
        histories, reviewed results, brackets and saved team/player records. A
        daily recovery file is refreshed every minute; the latest 14 days are
        kept on that volume. Download a copy to keep it outside Railway.
      </p>
      <a className="button secondary" href="/api/backup" download>
        Download current backup ↓
      </a>
      <details>
        <summary>Daily recovery files ({files.length})</summary>
        {files.map((file) => (
          <p key={file}>
            <a
              href={`/api/backups/file?name=${encodeURIComponent(file)}`}
              download
            >
              {file}
            </a>
            {allowDelete && (
              <button
                className="text-button danger"
                onClick={() => {
                  setDeleting(file);
                  setConfirmation("");
                }}
              >
                Delete backup
              </button>
            )}
          </p>
        ))}
      </details>
      {deleting && (
        <section
          className="data-confirm"
          role="dialog"
          aria-label="Delete backup"
        >
          <p>
            Permanently delete {deleting}? Other backups and saved games stay
            available. The current daily file may be created again by automatic
            backups.
          </p>
          <label>
            Type DELETE
            <input
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
            />
          </label>
          <button
            className="button primary"
            disabled={confirmation !== "DELETE" || busy}
            onClick={async () => {
              setBusy(true);
              try {
                const x = await workspaceRequest("backups/delete", {
                  name: deleting,
                  confirmation,
                });
                setFiles(x.files);
                setDeleting("");
                setNotice("Backup deleted.");
              } catch (e) {
                setNotice(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Permanently delete backup
          </button>
          <button className="button secondary" onClick={() => setDeleting("")}>
            Cancel
          </button>
        </section>
      )}
      <label>
        Restore a studio backup
        <input
          type="file"
          accept=".json,.gz"
          onChange={(e) => read(e.target.files?.[0])}
        />
      </label>
      {pending && (
        <div className="production-notice">
          <p>
            Restore {pending.matches.length} saved games and{" "}
            {pending.drafts?.length || 0} drafts. This replaces shared controls
            and matching archive entries; other saved games remain. Stop live
            collection first. Paired-PC credentials are not restored.
            {pending.rosterLibrary &&
              ` Saved rosters: ${pending.rosterLibrary.teams?.length || 0} teams and ${pending.rosterLibrary.players?.length || 0} players will be merged into the library.`}
          </p>
          <button className="button primary" disabled={busy} onClick={restore}>
            Restore this backup
          </button>
          <button className="button secondary" onClick={() => setPending(null)}>
            Cancel
          </button>
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}

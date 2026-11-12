import { useState } from "react";
import { workspaceRequest } from "./workspace-context.js";
import "./OfflineImport.css";

export default function OfflineImport({ drafts = [], onImported }) {
  const [id, setId] = useState("");
  const [draftId, setDraftId] = useState("");
  const [allowSteam, setAllowSteam] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [result, setResult] = useState(null);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setNotice("");
    setResult(null);
    try {
      const saved = await workspaceRequest("data/import-match", {
        id: id.trim(),
        draftId,
        allowSteam,
      });
      setResult(saved);
      onImported?.();
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="offline-import production-card">
      <div className="offline-intro">
        <span className="eyebrow">THE GAMES BEYOND THE STREAM</span>
        <h2>Record an off-stream match</h2>
        <p>
          Save a finished match by ID, even when nobody used the live tracker.
          Its statistics join your tournament library, scoreboard review and
          reports.
        </p>
      </div>
      <form onSubmit={submit}>
        <label>
          Deadlock match ID
          <input
            required
            inputMode="numeric"
            pattern="[1-9][0-9]{0,14}"
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder="e.g. 120513539"
          />
        </label>
        <label>
          Link a saved draft (optional)
          <select value={draftId} onChange={(e) => setDraftId(e.target.value)}>
            <option value="">No draft linked</option>
            {drafts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label || d.id}
              </option>
            ))}
          </select>
        </label>
        <p className="production-hint">
          Link a saved Statlocker or manual draft to retain its actual pick/ban
          sequence. Hero priority uses saved drafts only; importing a finished
          match does not create draft picks or bans.
        </p>
        <label className="check-label">
          <input
            type="checkbox"
            checked={allowSteam}
            onChange={(e) => setAllowSteam(e.target.checked)}
          />
          Allow Steam metadata lookup if it is not cached
        </label>
        <p className="production-hint">
          Cached lookup is the default. Steam fallback has a small shared rate
          limit. Missing or expired data cannot be recovered from an ID alone.
        </p>
        <button className="button primary" disabled={busy}>
          {busy ? "Importing finished match…" : "Import match"}
        </button>
      </form>
      {notice && (
        <p className="production-notice" role="alert">
          {notice}
        </p>
      )}
      {result && (
        <div className="offline-result" role="status">
          <h3>Match {result.id} saved</h3>
          <p>
            {result.players} players · {result.purchases} recorded item entries
            processed automatically.
          </p>
          <p>
            The current live feed and on-air result continue as before. Select
            this match in Live desk to review, rename players and publish its
            scoreboard. Importing does not award a series point.
          </p>
          {!result.bansKnown && (
            <p>
              Ban information was unavailable. A saved draft can supply it; no
              missing bans were filled in.
            </p>
          )}
        </div>
      )}
      <details>
        <summary>What is available after import?</summary>
        <ul>
          <li>
            Final teams/heroes, K/D/A, net worth, recorded
            damage/healing/objective samples and souls history when the source
            provides them.
          </li>
          <li>
            Souls by source from the recorded income breakdown. This is
            different from current net worth.
          </li>
          <li>
            Recorded item picks are included automatically in Top items.
            Metadata does not prove refunds or final held inventory.
          </li>
          <li>
            Publishing uses the same reviewed scoreboard flow as recorded
            matches. If metadata is missing, the existing replay rehearsal can
            inspect an available Valve replay, or a saved local demo can be
            retained for later analysis.
          </li>
        </ul>
      </details>
    </section>
  );
}

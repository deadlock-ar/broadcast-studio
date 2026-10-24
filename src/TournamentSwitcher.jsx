import { useState, useRef } from "react";
import { useWorkspace } from "./workspace-context.js";
export default function TournamentSwitcher() {
  const shared = useWorkspace(),
    [name, setName] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const form = useRef(null);
  async function run(path, value) {
    setBusy(true);
    setNotice("");
    try {
      await shared.command(path, value);
      setName("");
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
      <details ref={form}>
        <summary>+ New tournament</summary>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run("tournaments/create", { name });
          }}
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
          <button className="button primary" disabled={busy || shared.saving}>
            Create & select
          </button>
        </form>
      </details>
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}

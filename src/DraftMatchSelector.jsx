import { useState } from "react";
import { bracketOutput } from "./bracket.js";
import { useWorkspace } from "./workspace-context.js";
import "./DraftMatchSelector.css";

export default function DraftMatchSelector({ onStarted }) {
  const shared = useWorkspace();
  const bracket = shared.data.bracket;
  const output = bracketOutput(bracket);
  const options = output.rounds.flatMap((round) =>
    round.matches
      .filter(
        (match) =>
          match.required !== false &&
          match.status === "ready" &&
          match.teams.every(Boolean),
      )
      .map((match) => ({ ...match, roundName: round.name })),
  );
  const [selected, setSelected] = useState(bracket.activeMatchId || "");
  const [pending, setPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const value = options.some((match) => match.id === selected) ? selected : "";
  const current = output.rounds
    .flatMap((round) => round.matches)
    .find((match) => match.id === shared.data.draft.bracketMatchId);
  const live = shared.data.draft.mode === "live";
  const disabled =
    busy || shared.saving || shared.changingTournament || shared.readOnly;
  async function start() {
    if (disabled || !value || live) return;
    setBusy(true);
    setNotice("");
    try {
      await shared.command("bracket/prepare", {
        matchId: value,
        expectedRevision: bracket.revision,
        startDraft: true,
      });
      setPending(false);
      setNotice(
        "Match loaded. Connect its Statlocker room below, or make picks manually.",
      );
      onStarted?.();
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="draft-match-selector"
      aria-label="Select a bracket match for this draft"
    >
      <div>
        <h2>Draft a bracket match</h2>
        <p>
          {current
            ? `Current draft: ${current.teams.map((team) => team?.name || "To be decided").join(" vs ")} · ${current.seriesFormat}`
            : "Load the match’s teams and format, then connect its draft room or draft manually."}
        </p>
      </div>
      <div className="draft-match-actions">
        <label>
          Bracket match
          <select
            aria-label="Draft bracket match"
            value={value}
            disabled={disabled || live}
            onChange={(event) => {
              setSelected(event.target.value);
              setPending(false);
              setNotice("");
            }}
          >
            <option value="">
              {options.length
                ? "Choose a ready match…"
                : "No ready bracket matches"}
            </option>
            {options.map((match) => (
              <option key={match.id} value={match.id}>
                {match.roundName} · {match.teams[0].name} vs{" "}
                {match.teams[1].name} · {match.seriesFormat}
              </option>
            ))}
          </select>
        </label>
        <button
          className="button primary"
          disabled={disabled || live || !value}
          onClick={() =>
            shared.data.draft.snapshot.steps.some((step) => step.heroId)
              ? setPending(true)
              : start()
          }
        >
          Start draft for selected match
        </button>
      </div>
      {live && (
        <p>Disconnect the current live draft before choosing another match.</p>
      )}
      {!options.length && (
        <p>
          Add teams and generate a draw in{" "}
          <a href="/?tab=bracket">Bracket ↗</a>. Matches appear here when both
          teams are known.
        </p>
      )}
      {pending && (
        <div
          className="draft-match-confirm"
          role="group"
          aria-label="Start a new bracket draft"
        >
          <p>
            This saves the current draft and opens an empty board for the
            selected match.
          </p>
          <button
            className="button primary"
            disabled={disabled}
            onClick={start}
          >
            Save current draft and start match
          </button>
          <button
            className="button secondary"
            disabled={disabled}
            onClick={() => setPending(false)}
          >
            Keep current draft
          </button>
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}

export default function RecordingEvidence({ session }) {
  const entries = Array.isArray(session?.audit?.entries)
    ? session.audit.entries.slice(-500)
    : [];
  function download() {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            match: session.id,
            complete: false,
            scope:
              "Partial console entries from one demo; player attribution unavailable",
            entries,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob),
      link = document.createElement("a");
    link.href = url;
    link.download = `recorded-console-${session.id}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <details className="production-card recording-evidence">
      <summary>
        Recorded console entries · partial, unattributed ({entries.length})
      </summary>
      <p>
        These are entries carried by this recording, with source ticks. They do
        not show every player's commands or prove a cheat-free match. Some game
        commands are deliberately omitted from demos. The last 500 entries are
        retained.
      </p>
      <p>
        The game's current command dump marks recording as cheat-protected. Test
        starting a recording, disabling cheats and checking both continued
        twelve-player capture and blocked player commands in a custom lobby
        before adopting that workflow. The studio does not change game settings.
      </p>
      {entries.length ? (
        <>
          <button className="button secondary" onClick={download}>
            Download partial console entries
          </button>
          <div className="recording-evidence-rows">
            {entries.map((entry, index) => (
              <div key={index}>
                <span>
                  Tick {Number.isFinite(entry.tick) ? entry.tick : "—"}
                </span>
                <code>
                  {String(entry.command || "").slice(0, 500)}
                  {entry.truncated ? " [truncated]" : ""}
                </code>
              </div>
            ))}
          </div>
        </>
      ) : (
        <p>
          No console entries are available for this source. This is not evidence
          that nobody used cheats.
        </p>
      )}
    </details>
  );
}

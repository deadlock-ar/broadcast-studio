import { captureCoverage } from "./capture-coverage.js";

export default function CaptureDataStatus({ session }) {
  if (!session?.match && !session?.result) return null;
  const coverage = captureCoverage(session);
  return (
    <details
      className="production-card production-coverage"
      open={coverage.ended && coverage.messages.length > 0}
    >
      <summary>
        Captured data · Items {coverage.inventories}/12 · Ability levels{" "}
        {coverage.abilityPlayers}/12 · Souls by source {coverage.sourcePlayers}
        /12
      </summary>
      {coverage.messages.length ? (
        <ul>
          {coverage.messages.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      ) : (
        <p>
          All twelve players have recorded item inventories, ability levels and
          souls-by-source data.
        </p>
      )}
      {session.items?.fromStart === false && (
        <p>
          The recording did not cover the full match, so top items may omit
          earlier purchases.
        </p>
      )}
      {coverage.sourcePlayers > 0 && (
        <p>
          Souls by source records earned income. It can differ from total net
          worth; missing components remain recorded subtotals.
        </p>
      )}
    </details>
  );
}

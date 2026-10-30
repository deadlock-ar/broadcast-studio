import "./BracketScreen.css";

export default function BracketScreen({ bracket }) {
  if (!bracket || bracket.visible === false) return null;
  const rounds = bracket.rounds || [];
  const count = rounds.length;
  const firstCount = Math.max(1, rounds[0]?.matches.length || 1);
  const boxHeight = firstCount > 8 ? 46 : firstCount > 4 ? 66 : 84;
  const area = { x: 72, y: 207, width: 1776, height: 760 };
  const gap = count > 4 ? 28 : 42;
  const width = count ? (area.width - (count - 1) * gap) / count : 0;
  const position = (round, index) => ({
    x: area.x + round * (width + gap),
    y: area.y + ((index + 0.5) * area.height) / rounds[round].matches.length,
  });
  return (
    <section
      className={`bracket-screen${bracket.transparent ? " is-transparent" : ""}${firstCount > 8 ? " is-dense" : ""}`}
      aria-label="Tournament bracket screen"
      data-format={bracket.format}
    >
      <header className="bracket-screen-heading">
        <div>
          <span className="bracket-screen-kicker">THE ROAD TO THE FINAL</span>
          <h1>{bracket.title || "Tournament bracket"}</h1>
        </div>
        <div className="bracket-screen-format">
          <span>
            {bracket.format === "double"
              ? "Double elimination"
              : "Single elimination"}
          </span>
          <strong>{bracket.seriesFormat || "BO3"}</strong>
        </div>
      </header>
      {rounds.length ? (
        <>
          <svg
            className="bracket-screen-connectors"
            viewBox="0 0 1920 1080"
            aria-hidden="true"
          >
            {rounds.slice(0, -1).flatMap((round, roundIndex) =>
              round.matches.map((match, matchIndex) => {
                const start = position(roundIndex, matchIndex);
                const next =
                  rounds[roundIndex + 1]?.matches[Math.floor(matchIndex / 2)];
                if (!next) return null;
                const end = position(
                  roundIndex + 1,
                  Math.floor(matchIndex / 2),
                );
                const mid = start.x + width + gap / 2;
                return (
                  <path
                    key={match.id}
                    d={`M${start.x + width} ${start.y}H${mid}V${end.y}H${end.x}`}
                  />
                );
              }),
            )}
          </svg>
          {rounds.map((round, roundIndex) => (
            <div className="bracket-screen-round" key={round.id || roundIndex}>
              <h2 style={{ left: area.x + roundIndex * (width + gap), width }}>
                {round.name || `Round ${roundIndex + 1}`}
              </h2>
              {round.matches.map((match, matchIndex) => {
                const point = position(roundIndex, matchIndex);
                return (
                  <article
                    className={`bracket-screen-match${match.id === bracket.activeMatchId ? " is-on-air" : ""}${match.status === "complete" || match.status === "bye" ? " is-complete" : ""}`}
                    key={match.id}
                    style={{
                      left: point.x,
                      top: point.y - boxHeight / 2,
                      width,
                      height: boxHeight,
                    }}
                    aria-label={`${round.name}, match ${matchIndex + 1}`}
                    data-match-id={match.id}
                    data-status={match.status}
                  >
                    {[0, 1].map((side) => {
                      const team = match.teams?.[side];
                      const won = team && match.winnerId === team.id;
                      return (
                        <div
                          className={`bracket-screen-team${won ? " is-winner" : ""}${!team ? " is-empty" : ""}`}
                          key={side}
                        >
                          {team?.logo ? (
                            <img src={team.logo} alt="" />
                          ) : (
                            <span className="bracket-screen-team-mark">
                              {team?.tag || team?.name?.slice(0, 2) || "—"}
                            </span>
                          )}
                          <span className="bracket-screen-team-name">
                            {team?.name ||
                              (match.bye || match.status === "bye"
                                ? "BYE"
                                : "To be decided")}
                          </span>
                          <strong>
                            {team
                              ? match.status === "bye"
                                ? won
                                  ? "W"
                                  : "—"
                                : (match.scores?.[side] ?? 0)
                              : "—"}
                          </strong>
                          {won && (
                            <span
                              className="bracket-screen-winner-mark"
                              aria-label="Winner"
                            >
                              ✦
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </article>
                );
              })}
            </div>
          ))}
        </>
      ) : (
        <div className="bracket-screen-empty">
          <span>✦</span>
          <h2>The bracket is being prepared</h2>
          <p>Matchups will appear here when the tournament is ready.</p>
        </div>
      )}
      <footer className="bracket-screen-footer">
        <span>
          {bracket.champion ? "TOURNAMENT WINNER" : "EVERY MATCH COUNTS"}
        </span>
        {bracket.champion && <strong>{bracket.champion.name}</strong>}
        <span>DEADLOCK AR</span>
      </footer>
    </section>
  );
}

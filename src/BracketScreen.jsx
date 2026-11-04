import "./BracketScreen.css";

export default function BracketScreen({ bracket }) {
  if (!bracket || bracket.visible === false) return null;
  const rounds = bracket.rounds || [];
  const count = rounds.length;
  // Public matches retain their tree positions. Empty branches and automatic
  // advances are not fixtures, even while an upstream result is still pending.
  const occupied = rounds.map((round) => round.matches.map(() => false));
  const required = rounds.map((round, roundIndex) =>
    round.matches.map((match, matchIndex) => {
      const sides =
        roundIndex === 0
          ? [Boolean(match.teams?.[0]), Boolean(match.teams?.[1])]
          : [
              occupied[roundIndex - 1][matchIndex * 2],
              occupied[roundIndex - 1][matchIndex * 2 + 1],
            ];
      occupied[roundIndex][matchIndex] = sides.some(Boolean);
      return typeof match.required === "boolean"
        ? match.required
        : sides.every(Boolean);
    }),
  );
  const formats = [
    ...new Set(
      rounds.map(
        (round) => round.seriesFormat || bracket.seriesFormat || "BO3",
      ),
    ),
  ];
  const area = { x: 72, y: 207, width: 1776, height: 760 };
  const gap = count > 4 ? 28 : 42;
  const width = count ? (area.width - (count - 1) * gap) / count : 0;
  const position = (round, index) => ({
    x: area.x + round * (width + gap),
    y: area.y + ((index + 0.5) * area.height) / rounds[round].matches.length,
  });
  const boxHeights = rounds.map((round, roundIndex) => {
    const indexes = round.matches
      .map((_, index) => index)
      .filter((index) => required[roundIndex][index]);
    const spacing = indexes
      .slice(1)
      .map(
        (index, at) =>
          ((index - indexes[at]) * area.height) / round.matches.length,
      );
    return Math.min(...spacing, 86) > 70 ? 84 : 46;
  });
  return (
    <section
      className={`bracket-screen${bracket.transparent ? " is-transparent" : ""}`}
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
          <strong>
            {formats.length > 1
              ? "Mixed series"
              : formats[0] || bracket.seriesFormat || "BO3"}
          </strong>
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
                if (!required[roundIndex][matchIndex]) return null;
                const start = position(roundIndex, matchIndex);
                let nextRound = roundIndex + 1;
                let nextIndex = Math.floor(matchIndex / 2);
                while (nextRound < count && !required[nextRound][nextIndex]) {
                  nextRound++;
                  nextIndex = Math.floor(nextIndex / 2);
                }
                if (!rounds[nextRound]?.matches[nextIndex]) return null;
                const end = position(nextRound, nextIndex);
                const mid = end.x - gap / 2;
                return (
                  <path
                    key={match.id}
                    d={`M${start.x + width} ${start.y}H${mid}V${end.y}H${end.x}`}
                  />
                );
              }),
            )}
          </svg>
          {rounds.map(
            (round, roundIndex) =>
              required[roundIndex].some(Boolean) && (
                <div
                  className="bracket-screen-round"
                  key={round.id || roundIndex}
                >
                  <h2
                    style={{ left: area.x + roundIndex * (width + gap), width }}
                  >
                    {round.name || `Round ${roundIndex + 1}`}
                    <span className="bracket-screen-round-format">
                      {round.seriesFormat || bracket.seriesFormat || "BO3"}
                    </span>
                  </h2>
                  {round.matches.map((match, matchIndex) => {
                    if (!required[roundIndex][matchIndex]) return null;
                    const point = position(roundIndex, matchIndex);
                    const boxHeight = boxHeights[roundIndex];
                    return (
                      <article
                        className={`bracket-screen-match${match.id === bracket.activeMatchId ? " is-on-air" : ""}${match.status === "complete" ? " is-complete" : ""}${boxHeight <= 50 ? " is-dense" : ""}`}
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
                        data-series-format={
                          match.seriesFormat ||
                          round.seriesFormat ||
                          bracket.seriesFormat
                        }
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
                                {team?.name || "To be decided"}
                              </span>
                              <strong>
                                {team ? (match.scores?.[side] ?? 0) : "—"}
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
              ),
          )}
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

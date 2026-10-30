import heroes from "./heroes.json";
import items from "./items.json";
import signatures from "../collector/data/signatures.json";
import { keyPlayers } from "../collector/enrichment.mjs";
import { clock, displayNumber as n } from "./stats.js";
const heroMap = new Map(heroes.map((h) => [h.id, h])),
  itemMap = new Map(items.map((i) => [i.id, i]));
export default function MatchScoreboard({ result }) {
  if (!result)
    return (
      <div className="production-canvas scoreboard-empty">
        Waiting for a published match result.
      </div>
    );
  const match = result.match,
    leaders = keyPlayers(match.players),
    name = (p) => result.names?.[p.id] || p.name;
  const mvp = match.players.find((p) => p.id === result.mvpId);
  const officialKeyPlayers = match.players
    .filter((p) => [2, 3].includes(p.mvpRank))
    .sort((a, b) => a.mvpRank - b.mvpRank);
  const total = (players, key) =>
    players.every((p) => Number.isFinite(p[key]))
      ? players.reduce((v, p) => v + p[key], 0)
      : null;
  return (
    <div className="production-canvas complete-scoreboard">
      <header className="complete-score-header">
        <img src="/logo.png" alt="Deadlock AR" />
        <div>
          <small>{result.event || "DEADLOCK AR"}</small>
          <h1>
            Match results <span>✦</span>
          </h1>
        </div>
        <aside>
          <b>
            {result.round} · {result.format} · GAME {result.game}
          </b>
          <span>
            {clock(match.duration)} · MATCH{" "}
            {match.matchId ||
              (/^\d+$/.test(match.id) ? match.id : "ID unavailable")}
          </span>
        </aside>
      </header>
      <div className="complete-score-teams">
        {[0, 1].map((team) => {
          const players = match.players
            .filter((p) => p.team === team)
            .sort((a, b) => a.slot - b.slot);
          return (
            <section
              key={team}
              className={`complete-score-team ${result.winner === team ? "winner" : ""}`}
            >
              <header>
                {result.teams[team].logo && (
                  <img src={result.teams[team].logo} alt="" />
                )}
                <div>
                  <small>{result.winner === team ? "VICTORY" : "DEFEAT"}</small>
                  <h2 dir="auto">{result.teams[team].name}</h2>
                </div>
                <b>
                  {result.teams[team].score}
                  <small>SERIES</small>
                </b>
              </header>
              <div className="score-player-grid score-column-labels">
                {[
                  "PLAYER",
                  "SOULS",
                  "K / D / A",
                  "DAMAGE",
                  "OBJECTIVE DAMAGE",
                  "HEALING",
                ].map((s) => (
                  <span key={s}>{s}</span>
                ))}
              </div>
              {players.map((p) => (
                <div key={p.id} className="score-player-grid score-player">
                  <div className="score-identity">
                    <img
                      src={heroMap.get(p.heroId)?.image}
                      alt={heroMap.get(p.heroId)?.name}
                    />
                    <strong dir="auto" title={name(p)}>
                      {name(p)}
                      {p.id === result.mvpId && <small>✦ MVP</small>}
                    </strong>
                  </div>
                  <b>{n(p.souls)}</b>
                  <b>
                    {n(p.kills)} / {n(p.deaths)} / {n(p.assists)}
                  </b>
                  <b>{n(p.damage)}</b>
                  <b>{n(p.objectiveDamage)}</b>
                  <b>{n(p.healing)}</b>
                  <div className="score-loadout">
                    <div
                      className="score-items"
                      aria-label={`${name(p)} items`}
                    >
                      {Array.isArray(p.items) ? (
                        p.items.length ? (
                          p.items.map((id, i) => {
                            const item = itemMap.get(id);
                            return item ? (
                              <img
                                key={`${id}:${i}`}
                                src={item.image}
                                alt={item.name}
                                title={item.name}
                              />
                            ) : null;
                          })
                        ) : (
                          <small>No items</small>
                        )
                      ) : (
                        <small>Items unavailable</small>
                      )}
                    </div>
                    <div
                      className="score-abilities"
                      aria-label={`${name(p)} ability upgrades`}
                    >
                      {[0, 1, 2, 3].map((i) => {
                        const a = p.abilities?.[i],
                          meta = signatures[p.heroId]?.[i];
                        return (
                          <span
                            key={i}
                            title={`${meta?.name || `Ability ${i + 1}`} · ${a?.level ?? "unknown"} upgrades`}
                          >
                            {meta?.image && (
                              <img src={meta.image} alt={meta.name} />
                            )}
                            <b>
                              {a?.unlocked === false ? "L" : (a?.level ?? "—")}
                            </b>
                          </span>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ))}
              <footer>
                <small>TEAM TOTAL</small>
                <span>
                  <b>{n(total(players, "kills"))}</b> KILLS
                </span>
                <span>
                  <b>{n(total(players, "souls"))}</b> SOULS
                </span>
                <span>
                  <b>{n(total(players, "damage"))}</b> DAMAGE
                </span>
              </footer>
            </section>
          );
        })}
      </div>
      <footer className="score-key-players">
        {mvp && (
          <span className="score-mvp">
            ✦ MVP <b>{name(mvp)}</b>
          </span>
        )}
        {officialKeyPlayers.map((p) => (
          <span key={p.id}>
            <small>KEY PLAYER</small>
            <b>{name(p)}</b>
          </span>
        ))}
        {(officialKeyPlayers.length ? [] : leaders).map((l) => (
          <span key={l.metric}>
            <small>{l.label.toUpperCase()}</small>
            <b>{name(match.players.find((p) => p.id === l.playerId))}</b>
            <em>{n(l.value)}</em>
          </span>
        ))}
      </footer>
    </div>
  );
}

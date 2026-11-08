import heroes from "./heroes.json";
import items from "./items.json";
import signatures from "../collector/data/signatures.json";
import { keyPlayers } from "../collector/enrichment.mjs";
import { clock, displayNumber as n } from "./stats.js";
import SoulsGraph from "./SoulsGraph.jsx";
import "./MatchScoreboard.css";
import TeamLogo from "./TeamLogo.jsx";

const heroMap = new Map(heroes.map((h) => [h.id, h]));
const itemMap = new Map(items.map((i) => [i.id, i]));
const rows = [
  ["souls", "TOTAL SOULS"],
  ["kills", "KILLS"],
  ["deaths", "DEATHS"],
  ["assists", "ASSISTS"],
  ["damage", "HERO DAMAGE"],
  ["objectiveDamage", "OBJECTIVE DAMAGE"],
  ["healing", "HEALING"],
];
const sum = (players, key) =>
  players.length === 6 && players.every((p) => Number.isFinite(p[key]))
    ? players.reduce((total, p) => total + p[key], 0)
    : null;
function Sources({ player }) {
  const sources = player.soulsBySource;
  if (!sources?.length)
    return (
      <div className="ds-sources ds-unavailable">
        Source breakdown unavailable
      </div>
    );
  const amount = (s) =>
    Number.isFinite(s.gold)
      ? s.gold
      : Number.isFinite(s.knownGold)
        ? s.knownGold
        : -1;
  const label = (s) =>
    Number.isFinite(s.gold)
      ? n(s.gold)
      : Number.isFinite(s.knownGold)
        ? n(s.knownGold)
        : "—";
  return (
    <div
      className="ds-sources"
      aria-label={`${player.name} souls by source; incomplete amounts are recorded subtotals`}
    >
      {sources
        .toSorted((a, b) => amount(b) - amount(a))
        .slice(0, 5)
        .map((s) => (
          <div
            key={s.source ?? s.label}
            title={`${s.label}: ${label(s)} souls${!Number.isFinite(s.gold) && Number.isFinite(s.knownGold) ? "; recorded subtotal" : ""}${s.complete === false ? "; incomplete source data" : ""}`}
          >
            <span>{s.label}</span>
            <b>{label(s)}</b>
          </div>
        ))}
    </div>
  );
}
function PlayerColumn({ player, name, mvp, keyPlayer, best }) {
  const hero = heroMap.get(player.heroId),
    held = player.items;
  const itemSlots = Array.isArray(held)
    ? [...held, ...Array(Math.max(0, 12 - held.length)).fill(null)]
    : [];
  return (
    <article
      className={`ds-player ${mvp ? "ds-mvp" : ""}`}
      aria-label={`${name} match statistics`}
    >
      <div className="ds-portrait">
        {hero?.image ? (
          <img src={hero.image} alt={hero.name} />
        ) : (
          <span>HERO {player.heroId}</span>
        )}
        {mvp && <b>✦ MVP</b>}
        {!mvp && keyPlayer && (
          <span className="ds-key-player-badge" title={keyPlayer}>
            KEY PLAYER
          </span>
        )}
      </div>
      <strong className="ds-player-name" dir="auto" title={name}>
        {name}
      </strong>
      {rows.map(([key, label]) => (
        <div
          key={key}
          className={`ds-number ${best[key] === player.id ? "ds-best" : ""}`}
          title={`${label}: ${n(player[key])}`}
        >
          {n(player[key])}
        </div>
      ))}
      <Sources player={player} />
      <div
        className={`ds-items ${itemSlots.length > 16 ? "ds-items-many" : ""}`}
        aria-label={`${name} final held items`}
      >
        {Array.isArray(held) ? (
          itemSlots.map((id, index) => {
            const item = itemMap.get(id);
            return (
              <span
                key={`${id}:${index}`}
                className={item?.category || "empty"}
                title={
                  id ? item?.name || `Unknown item ${id}` : "Empty item slot"
                }
              >
                {item ? (
                  <img src={item.image} alt={item.name} />
                ) : id ? (
                  "?"
                ) : (
                  ""
                )}
              </span>
            );
          })
        ) : (
          <small>Items unavailable</small>
        )}
      </div>
      <div
        className="ds-abilities"
        aria-label={`${name} ability upgrade tiers`}
      >
        {[0, 1, 2, 3].map((slot) => {
          const ability = player.abilities?.[slot],
            meta = signatures[player.heroId]?.[slot];
          return (
            <span
              key={slot}
              title={`${meta?.name || `Ability ${slot + 1}`}: ${ability?.level ?? "unknown"} upgrades`}
            >
              {meta?.image && <img src={meta.image} alt="" />}
              <b>
                {ability?.unlocked === false ? "L" : (ability?.level ?? "—")}
              </b>
            </span>
          );
        })}
      </div>
    </article>
  );
}
export default function MatchScoreboard({ result }) {
  if (!result)
    return (
      <div className="production-canvas scoreboard-empty">
        Waiting for a published match result.
      </div>
    );
  const match = result.match,
    name = (p) =>
      result.names?.[p.id] || p.name || heroMap.get(p.heroId)?.name || "Player";
  const teams = [0, 1].map((team) =>
    match.players
      .filter((p) => p.team === team)
      .toSorted((a, b) => a.slot - b.slot),
  );
  const teamNames = [0, 1].map(
    (team) => result.teams?.[team]?.name || (team ? "Sapphire" : "Amber"),
  );
  const best = Object.fromEntries(
    rows
      .filter(([key]) => key !== "deaths")
      .map(([key]) => [
        key,
        match.players
          .filter((p) => Number.isFinite(p[key]) && p[key] > 0)
          .toSorted((a, b) => b[key] - a[key])[0]?.id,
      ]),
  );
  const leaders = keyPlayers(match.players);
  const official = match.players
    .filter((p) => [2, 3].includes(p.mvpRank))
    .toSorted((a, b) => a.mvpRank - b.mvpRank);
  const keyPlayerLabels = new Map();
  if (official.length) {
    for (const player of official)
      keyPlayerLabels.set(
        player.id,
        `Match key player (rank ${player.mvpRank})`,
      );
  } else {
    for (const leader of leaders)
      keyPlayerLabels.set(
        leader.playerId,
        [keyPlayerLabels.get(leader.playerId), leader.label]
          .filter(Boolean)
          .join(" · "),
      );
  }
  return (
    <div className="production-canvas deadlock-scoreboard">
      <header className="ds-ribbon">
        {[0, 1].map((team) => (
          <section
            key={team}
            className={`ds-team-heading ds-team-${team} ${result.winner === team ? "ds-victory" : ""}`}
          >
            <TeamLogo logo={result.teams?.[team]?.logo} />
            <div className="ds-team-title">
              <small>{result.winner === team ? "VICTORY" : "DEFEAT"}</small>
              <h2 dir="auto" title={teamNames[team]}>
                {teamNames[team]}
              </h2>
            </div>
            <div className="ds-team-total">
              <small>SOULS</small>
              <b>{n(sum(teams[team], "souls"))}</b>
            </div>
            <div className="ds-team-total">
              <small>KILLS</small>
              <b>{n(sum(teams[team], "kills"))}</b>
            </div>
            <div className="ds-series">
              <b>{result.teams?.[team]?.score ?? "—"}</b>
              <small>SERIES</small>
            </div>
          </section>
        ))}
        <div className="ds-match-clock">
          <small>FINAL · GAME {result.game || 1}</small>
          <b>{clock(match.duration)}</b>
          <span>
            {result.format || ""} · {result.round || "MATCH RESULT"}
          </span>
        </div>
      </header>
      <div className="ds-board">
        {[0, 1].map((team) => (
          <section
            key={team}
            className={`ds-roster ds-roster-${team}`}
            aria-label={teamNames[team]}
          >
            {teams[team].map((p) => (
              <PlayerColumn
                key={p.id}
                player={p}
                name={name(p)}
                mvp={p.id === result.mvpId}
                keyPlayer={keyPlayerLabels.get(p.id)}
                best={best}
              />
            ))}
          </section>
        ))}
        <aside className="ds-labels">
          <div className="ds-community-mark">
            <img src="/logo.png" alt="Deadlock AR" />
            <span>{result.event || "DEADLOCK AR"}</span>
            <b>MATCH RESULTS</b>
          </div>
          {rows.map(([, label]) => (
            <span key={label}>{label}</span>
          ))}
          <span>SOULS BY SOURCE</span>
          <span>FINAL ITEMS</span>
          <span>ABILITY TIERS</span>
        </aside>
      </div>
      <SoulsGraph telemetry={match.telemetry} teamNames={teamNames} />
      <footer className="ds-footer">
        <span>
          MATCH{" "}
          {match.matchId ||
            (/^\d+$/.test(match.id) ? match.id : "ID UNAVAILABLE")}
        </span>
        <span>
          {match.telemetry?.points?.length
            ? "RECORDED SAMPLES"
            : "FINAL SNAPSHOT"}
        </span>
      </footer>
    </div>
  );
}

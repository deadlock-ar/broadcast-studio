import { useState } from "react";
import heroes from "./heroes.json";
import "./PlayerBannersScreen.css";

const heroById = new Map(heroes.map((hero) => [hero.id, hero]));
const count = new Intl.NumberFormat("en");

function BannerImage({ src, alt = "", className = "" }) {
  const [failed, setFailed] = useState("");
  return src && failed !== src ? (
    <img
      src={src}
      alt={alt}
      className={className}
      onError={() => setFailed(src)}
    />
  ) : null;
}

function HeroStat({ stat, index }) {
  const hero = heroById.get(Number(stat.heroId));
  const matches = Math.max(0, Number(stat.matches) || 0);
  const winRate = Number.isFinite(stat.winRate)
    ? stat.winRate
    : matches
      ? (Math.max(0, Number(stat.wins) || 0) / matches) * 100
      : null;
  return (
    <div className="player-banners-hero">
      <div className="player-banners-portrait">
        <BannerImage src={hero?.image} />
        <span className="player-banners-hero-position">0{index + 1}</span>
      </div>
      <strong className="player-banners-hero-name">
        {hero?.name || "Unknown hero"}
      </strong>
      <span className="player-banners-match-count">
        {count.format(matches)} <span>matches</span>
      </span>
      <span className="player-banners-win-rate">
        {winRate === null
          ? "—"
          : `${Math.max(0, Math.min(100, winRate)).toFixed(1)}%`}
        <span>win rate</span>
      </span>
    </div>
  );
}

function PlayerCard({ player, slot, showRanks }) {
  const occupied = Boolean(player?.name);
  const stats = (player?.heroes || []).slice(0, 3);
  const rank = player?.rank;
  const emptyMessage = !occupied
    ? "Awaiting player"
    : player.status === "missing"
      ? "Statistics not loaded"
      : player.status === "error"
        ? "Stats unavailable"
        : player.status === "empty"
          ? "No tracked matches"
          : "Stats not loaded";
  return (
    <article
      className={`player-banners-card${occupied ? "" : " is-empty"}`}
      aria-label={`Player ${slot + 1}: ${player?.name || "Awaiting player"}`}
    >
      <header className="player-banners-player-heading">
        <span className="player-banners-slot">PLAYER 0{slot + 1}</span>
        <h3 title={player?.name || undefined}>
          {player?.name || `Player ${slot + 1}`}
        </h3>
        {stats.length > 0 && player.status === "error" && (
          <span className="player-banners-stale">Last available stats</span>
        )}
      </header>
      {stats.length ? (
        <div className="player-banners-heroes" aria-label="Most played heroes">
          {Array.from({ length: 3 }, (_, index) =>
            stats[index] ? (
              <HeroStat
                key={`${stats[index].heroId}-${index}`}
                stat={stats[index]}
                index={index}
              />
            ) : (
              <div className="player-banners-hero is-unavailable" key={index}>
                <div className="player-banners-portrait">
                  <span>—</span>
                </div>
                <strong className="player-banners-hero-name">No matches</strong>
                <span className="player-banners-match-count">—</span>
                <span className="player-banners-win-rate">—</span>
              </div>
            ),
          )}
        </div>
      ) : (
        <div className="player-banners-no-stats">
          <span className="player-banners-empty-emblem" aria-hidden="true">
            ✦
          </span>
          <p>{emptyMessage}</p>
        </div>
      )}
      <footer className="player-banners-player-footer">
        {showRanks && occupied ? (
          rank ? (
            <div className="player-banners-rank">
              <BannerImage src={rank.image} />
              <span>{rank.name || "Rank"}</span>
            </div>
          ) : (
            <span className="player-banners-rank-unavailable">
              Rank unavailable
            </span>
          )
        ) : (
          <span className="player-banners-footer-mark" aria-hidden="true">
            — ✦ —
          </span>
        )}
      </footer>
    </article>
  );
}

function TeamRow({ team = {}, side, showRanks }) {
  return (
    <section
      className={`player-banners-team player-banners-team-${side + 1}`}
      aria-label={team.name || `Team ${side + 1}`}
    >
      <header className="player-banners-team-heading">
        <span className="player-banners-team-line" />
        <BannerImage src={team.logo} className="player-banners-team-logo" />
        <h2 title={team.name || undefined}>
          {team.name || `Team ${side + 1}`}
        </h2>
        <span className="player-banners-team-line" />
      </header>
      <div className="player-banners-roster">
        {Array.from({ length: 6 }, (_, slot) => (
          <PlayerCard
            key={slot}
            player={team.players?.[slot]}
            slot={slot}
            showRanks={showRanks}
          />
        ))}
      </div>
    </section>
  );
}

export default function PlayerBannersScreen({ banners }) {
  if (!banners || banners.visible === false) return null;
  return (
    <section
      className={`player-banners-screen${banners.transparent ? " is-transparent" : ""}`}
      aria-label="Player introduction screen"
    >
      <header className="player-banners-screen-heading">
        <div>
          <span className="player-banners-kicker">
            THE PLAYERS BEHIND THE PLAY
          </span>
          <h1>{banners.title || "Player introductions"}</h1>
        </div>
        <span className="player-banners-screen-label">MEET THE TEAMS</span>
      </header>
      <TeamRow
        team={banners.teams?.[0]}
        side={0}
        showRanks={banners.showRanks !== false}
      />
      <div className="player-banners-versus" aria-label="Versus">
        <span />
        <strong>VS</strong>
        <span />
      </div>
      <TeamRow
        team={banners.teams?.[1]}
        side={1}
        showRanks={banners.showRanks !== false}
      />
      <footer className="player-banners-screen-footer">
        <span>TOP HEROES · TRACKED MATCH HISTORY</span>
        <span>DEADLOCK AR</span>
      </footer>
    </section>
  );
}

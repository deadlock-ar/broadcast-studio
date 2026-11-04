import heroes from "./heroes.json";
import {
  changesSince,
  currentMetricRows,
  netWorthRates,
} from "../collector/telemetry.mjs";
import { clock, displayNumber as n } from "./stats.js";
import SoulsGraph from "./SoulsGraph.jsx";
import "./LiveMetrics.css";

const roster = new Map(heroes.map((h) => [h.id, h]));
const signed = (value) =>
  Number.isFinite(value)
    ? `${value > 0 ? "+" : value < 0 ? "−" : ""}${n(Math.round(Math.abs(value)))}`
    : "—";
export function LiveMetricsGraphic({
  session,
  teamNames = ["Amber", "Sapphire"],
  stale = false,
}) {
  const match = session?.result?.match || session?.match;
  const baseline = session?.settings?.metricsBaseline;
  const ended =
    session?.ended || session?.result || session?.status === "finished";
  const unavailable = stale || (!ended && session?.status !== "live");
  const changes = unavailable ? null : changesSince(match, baseline),
    rates = unavailable ? new Map() : netWorthRates(match);
  const delta = Boolean(baseline);
  const current = currentMetricRows(match);
  const title = delta ? `SINCE ${clock(baseline.time)}` : "MATCH TOTALS";
  return (
    <div className="production-canvas momentum-canvas">
      <header className="momentum-heading">
        <div>
          <small>DEADLOCK AR · LIVE DESK</small>
          <h1>
            The shape of the game <span>✦</span>
          </h1>
        </div>
        <aside>
          <b>{clock(match?.duration)}</b>
          <span>
            {ended
              ? "FINAL CAPTURE"
              : unavailable
                ? "FEED PAUSED · LAST RECEIVED"
                : "LAST RECEIVED · SOURCE CLOCK"}
          </span>
        </aside>
      </header>
      <SoulsGraph telemetry={match?.telemetry} teamNames={teamNames} />
      <div className="momentum-teams">
        {[0, 1].map((team) => (
          <section className={`momentum-team momentum-team-${team}`} key={team}>
            <header>
              <h2 dir="auto">{teamNames[team]}</h2>
              <b>{title}</b>
            </header>
            <div className="momentum-row momentum-labels">
              <span>PLAYER</span>
              <span>SOULS</span>
              <span>NET / MIN</span>
              <span>{delta ? "HERO Δ" : "HERO DMG"}</span>
              <span>{delta ? "OBJ Δ" : "OBJ DMG"}</span>
              <span>{delta ? "K / D / A Δ" : "K / D / A"}</span>
            </div>
            {(match?.players || [])
              .filter((p) => p.team === team)
              .toSorted((a, b) => a.slot - b.slot)
              .map((p) => {
                const measured = current.get(p.id),
                  values = delta ? changes?.get(p.id) : measured,
                  rate = rates.get(p.id),
                  hero = roster.get(p.heroId);
                return (
                  <div className="momentum-row" key={p.id}>
                    <div className="momentum-player">
                      {hero?.image && <img src={hero.image} alt={hero.name} />}
                      <strong dir="auto">
                        {session?.settings?.names?.[p.id] ||
                          p.name ||
                          hero?.name}
                      </strong>
                    </div>
                    <b>{n(measured?.souls)}</b>
                    <b
                      title={
                        rate
                          ? `${Math.round(rate.seconds)} observed game seconds; net worth change, not gross income`
                          : "Waiting for at least five complete observed seconds"
                      }
                    >
                      {signed(rate?.value)}
                    </b>
                    <b>{n(values?.damage)}</b>
                    <b>{n(values?.objectiveDamage)}</b>
                    <b>
                      {n(values?.kills)} / {n(values?.deaths)} /{" "}
                      {n(values?.assists)}
                    </b>
                  </div>
                );
              })}
          </section>
        ))}
      </div>
      <footer>
        <span>
          {delta
            ? "COUNTER CHANGES SINCE THE OPERATOR'S MARK"
            : "HERO / OBJECTIVE DAMAGE AND K/D/A ARE MATCH TOTALS"}
        </span>
        <span>
          NET / MIN: OBSERVED NET WORTH CHANGE · UP TO 60 GAME SECONDS
        </span>
      </footer>
    </div>
  );
}

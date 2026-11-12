import { useState } from "react";
import { casterSlots } from "./caster-stage.js";
import TeamLogo from "./TeamLogo.jsx";
import "./CasterScreen.css";

function StageImage({ src, className = "" }) {
  const [failed, setFailed] = useState("");
  return src && failed !== src ? (
    <img
      src={src}
      className={className}
      alt=""
      onError={() => setFailed(src)}
    />
  ) : null;
}

export default function CasterScreen({
  stage,
  preview = false,
  speaking = [],
}) {
  if (!stage || stage.visible === false) return null;
  const people = (stage.casters || []).slice(0, 4);
  const slots = casterSlots(people.length);
  const webcams = stage.layout === "webcams";
  const holes = webcams
    ? slots
        .map(
          (slot) =>
            `M${slot.x},${slot.y}h${slot.width}v${slot.height}h-${slot.width}z`,
        )
        .join(" ")
    : "";
  return (
    <section
      className={`caster-screen${stage.transparent ? " is-transparent" : ""}${webcams ? " has-cameras" : ""}`}
      aria-label="Caster desk broadcast"
    >
      {!stage.transparent && (
        <svg
          className="caster-screen-background"
          width="1920"
          height="1080"
          aria-hidden="true"
        >
          <path
            d={`M0,0H1920V1080H0z ${holes}`}
            fill="#17231f"
            fillRule="evenodd"
          />
          <path
            d="M38 200V38h162 M1720 38h162v162 M38 880v162h162 M1720 1042h162V880"
            fill="none"
            stroke="#b7ad7f"
            strokeWidth="2"
            opacity=".5"
          />
        </svg>
      )}
      <div className="caster-screen-topline">
        <span>DEADLOCK AR</span>
        <i /> <span>BEFORE THE FIRST PICK</span>
      </div>
      <header className="caster-screen-heading">
        <span className="caster-screen-ornament" aria-hidden="true">
          ✦
        </span>
        <div>
          <p>{stage.event || "TOURNAMENT BROADCAST"}</p>
          <h1>{stage.title || "The caster desk"}</h1>
        </div>
        <span className="caster-screen-ornament" aria-hidden="true">
          ✦
        </span>
      </header>
      {stage.subtitle && (
        <p className="caster-screen-subtitle">{stage.subtitle}</p>
      )}
      {people.map((person, index) => {
        const slot = slots[index];
        return (
          <article
            key={index}
            className={`caster-screen-person${preview && speaking.includes(index) ? " is-speaking" : ""}`}
            style={{ left: slot.x, top: slot.y, width: slot.width }}
          >
            <div
              className={`caster-screen-media${webcams ? " is-webcam" : ""}`}
              style={{ height: slot.height }}
            >
              {webcams ? (
                preview && (
                  <div className="caster-camera-guide">
                    <span>CAMERA {index + 1}</span>
                    <small>
                      {Math.round(slot.width)} × {slot.height}
                    </small>
                  </div>
                )
              ) : (
                <div className="caster-screen-avatar">
                  <StageImage src={person.avatar} />
                  <span aria-hidden="true">
                    {person.name?.slice(0, 1).toUpperCase() || "✦"}
                  </span>
                </div>
              )}
              <span className="caster-screen-corner corner-a" />
              <span className="caster-screen-corner corner-b" />
            </div>
            <div className="caster-screen-nameplate">
              <span>{person.role || "CASTER"}</span>
              <h2 dir="auto">{person.name || `Caster ${index + 1}`}</h2>
            </div>
          </article>
        );
      })}
      <section className="caster-screen-match" aria-label="Upcoming match">
        <div className="caster-screen-match-label">
          <span>UP NEXT</span>
          <i />
          <span>
            {[stage.round, stage.format].filter(Boolean).join(" · ") ||
              "THE NEXT MATCH"}
          </span>
        </div>
        <div className="caster-screen-matchup">
          {[0, 1].map((side) => (
            <div className={`caster-screen-team team-${side}`} key={side}>
              {stage.teams?.[side]?.resolved !== false &&
                stage.teams?.[side]?.name && (
                  <TeamLogo logo={stage.teams[side].logo} alt="" />
                )}
              <h2 dir="auto">{stage.teams?.[side]?.name || "To be decided"}</h2>
            </div>
          ))}
          <div className="caster-screen-series" aria-label="Series score">
            <strong>{stage.teams?.[0]?.score ?? "—"}</strong>
            <span aria-hidden="true">–</span>
            <strong>{stage.teams?.[1]?.score ?? "—"}</strong>
            <small>SERIES</small>
          </div>
        </div>
      </section>
      <footer className="caster-screen-footer">
        <i />
        <span>DEADLOCK AR COMMUNITY</span>
        <i />
      </footer>
    </section>
  );
}

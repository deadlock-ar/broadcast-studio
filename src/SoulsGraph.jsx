import { useId } from "react";
import { soulsSegments } from "../collector/telemetry.mjs";
import { clock, displayNumber } from "./stats.js";
import "./SoulsGraph.css";

export default function SoulsGraph({
  telemetry,
  teamNames = ["Amber", "Sapphire"],
}) {
  const id = useId().replaceAll(":", "");
  const segments = soulsSegments(telemetry),
    points = segments.flat();
  if (points.length < 2 || !segments.some((segment) => segment.length > 1))
    return (
      <section className="souls-graph souls-graph-empty">
        <header>
          <b>SOULS DIFFERENCE</b>
          <span>
            OBSERVED NET WORTH · {teamNames[0]} − {teamNames[1]}
          </span>
        </header>
        <p>
          Waiting for two complete team samples. Earlier history is unavailable.
        </p>
      </section>
    );
  const first = points[0],
    last = points.at(-1);
  const width = 1600,
    height = 104,
    left = 64,
    right = width - 16;
  const limit = Math.max(1000, ...points.map((p) => Math.abs(p.value))) * 1.12;
  const x = (time) =>
    left +
    ((time - first.time) / Math.max(1, last.time - first.time)) *
      (right - left);
  const y = (value) => height / 2 - (value / limit) * (height / 2 - 6);
  const leader =
    last.value === 0
      ? "EVEN"
      : `${teamNames[last.value > 0 ? 0 : 1]} +${displayNumber(Math.abs(last.value))}`;
  return (
    <section
      className="souls-graph"
      aria-label={`Souls difference: ${leader}. Recorded samples from ${clock(first.time)} to ${clock(last.time)}.`}
    >
      <header>
        <div>
          <b>SOULS DIFFERENCE</b>
          <span>
            OBSERVED NET WORTH · {teamNames[0]} − {teamNames[1]}
          </span>
        </div>
        <strong
          className={last.value < 0 ? "souls-negative" : "souls-positive"}
        >
          {leader}
        </strong>
      </header>
      <svg
        viewBox={`0 0 ${width} ${height + 21}`}
        role="img"
        aria-label="Observed team net worth difference over game time"
      >
        <defs>
          <clipPath id={`${id}-positive`}>
            <rect width={width} height={height / 2} />
          </clipPath>
          <clipPath id={`${id}-negative`}>
            <rect y={height / 2} width={width} height={height / 2} />
          </clipPath>
        </defs>
        {[0, 0.5, 1].map((fraction) => (
          <line
            key={fraction}
            x1={left}
            x2={right}
            y1={6 + fraction * (height - 12)}
            y2={6 + fraction * (height - 12)}
            className={fraction === 0.5 ? "souls-zero" : "souls-grid"}
          />
        ))}
        <text x="0" y="13">
          +{displayNumber(Math.round(limit))}
        </text>
        <text x="24" y={height / 2 + 4}>
          0
        </text>
        <text x="0" y={height - 4}>
          −{displayNumber(Math.round(limit))}
        </text>
        {segments.map((segment, index) => {
          const line = segment
            .map((p) => `${x(p.time)},${y(p.value)}`)
            .join(" ");
          const area = `${x(segment[0].time)},${height / 2} ${line} ${x(segment.at(-1).time)},${height / 2}`;
          return (
            <g key={index}>
              {["positive", "negative"].map((side) => (
                <g
                  key={side}
                  clipPath={`url(#${id}-${side})`}
                  className={`souls-${side}`}
                >
                  <polygon points={area} />
                  <polyline points={line} />
                </g>
              ))}
            </g>
          );
        })}
        {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
          <text
            key={fraction}
            x={left + fraction * (right - left)}
            y={height + 18}
            textAnchor={fraction === 1 ? "end" : "start"}
          >
            {clock(first.time + fraction * (last.time - first.time))}
          </text>
        ))}
      </svg>
    </section>
  );
}

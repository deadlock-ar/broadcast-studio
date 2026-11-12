import { useState } from "react";
import ultimateCatalog from "../collector/data/ultimates.json";
import {
  cleanUltimateBadges,
  ultimateCapabilities,
} from "../collector/ultimate-settings.mjs";
import "./UltimateControls.css";

export default function UltimateControls({
  session,
  catalog = [],
  busy = false,
  onChange,
}) {
  const [search, setSearch] = useState("");
  const settings = cleanUltimateBadges(session?.settings?.ultimateBadges);
  const update = (changes) =>
    onChange(cleanUltimateBadges({ ...settings, ...changes }));
  const toggle = (abilityId, kind, checked) =>
    update({
      byAbility: {
        ...settings.byAbility,
        [abilityId]: {
          hit: settings.byAbility[abilityId]?.hit !== false,
          effect: settings.byAbility[abilityId]?.effect !== false,
          [kind]: checked,
        },
      },
    });
  const available = [...(catalog.length ? catalog : ultimateCatalog)].sort(
    (a, b) => a.heroName.localeCompare(b.heroName),
  );
  const shown = available.filter((ability) =>
    `${ability.heroName} ${ability.name}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <section className="production-card ultimate-controls">
      <h3>Ultimate indicators</h3>
      <label className="ultimate-master">
        <input
          type="checkbox"
          checked={settings.enabled}
          disabled={busy}
          onChange={(event) => update({ enabled: event.target.checked })}
        />
        Show ultimate indicators
      </label>
      <div className="production-calibration">
        <label>
          Icon size (px)
          <input
            type="number"
            min="12"
            max="48"
            step="1"
            key={`${session?.id}:${settings.iconSize}`}
            defaultValue={settings.iconSize}
            disabled={busy}
            onBlur={(event) => {
              if (Number(event.target.value) !== settings.iconSize)
                update({ iconSize: Number(event.target.value) });
            }}
          />
        </label>
        <label>
          Maximum indicators per player
          <select
            value={settings.maxPerPlayer}
            disabled={busy}
            onChange={(event) =>
              update({ maxPerPlayer: Number(event.target.value) })
            }
          >
            {[1, 2, 3, 4].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="production-hint">
        Icons automatically fit the space around the portrait. Damage hits stay
        one extra second before fading; lasting effects clear when the recorded
        effect ends.
      </p>
      <details>
        <summary>Choose which ultimates to show</summary>
        <p className="production-hint">
          Damage hits and lasting effects are independent. Only detected
          interactions can appear; casts, ally buffs and unverified effects are
          not shown.
        </p>
        <label className="ultimate-search">
          Find a hero or ultimate
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <div className="ultimate-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Ultimate</th>
                <th>Damage hit</th>
                <th>Lasting effect</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((ability) => {
                const capability = ultimateCapabilities(ability);
                return (
                  <tr key={ability.id}>
                    <th scope="row">
                      <strong>{ability.heroName}</strong>
                      <span>{ability.name}</span>
                    </th>
                    {["hit", "effect"].map((kind) => (
                      <td key={kind}>
                        <input
                          type="checkbox"
                          aria-label={`${ability.heroName} ${ability.name} ${kind === "hit" ? "damage hits" : "lasting effects"}`}
                          checked={
                            capability[kind] &&
                            settings.byAbility[ability.id]?.[kind] !== false
                          }
                          disabled={
                            busy || !settings.enabled || !capability[kind]
                          }
                          onChange={(event) =>
                            toggle(ability.id, kind, event.target.checked)
                          }
                        />
                        {!capability[kind] && (
                          <small>
                            {kind === "hit" ? "Unavailable" : "Not detected"}
                          </small>
                        )}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!shown.length && (
          <p className="production-hint">No matching ultimates.</p>
        )}
      </details>
    </section>
  );
}

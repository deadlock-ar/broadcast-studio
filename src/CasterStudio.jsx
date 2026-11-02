import { useEffect, useRef, useState } from "react";
import { useWorkspace } from "./workspace-context.js";
import { bracketOutput } from "./bracket.js";
import { safeImage } from "./draft.js";
import {
  cleanCasterStage,
  casterStageOutput,
  casterSlots,
  discordVoiceUrl,
} from "./caster-stage.js";
import CasterScreen from "./CasterScreen.jsx";
import "./CasterStudio.css";

export default function CasterStudio({ active = true }) {
  const shared = useWorkspace();
  const workspace = shared?.data || {};
  const settings = cleanCasterStage(workspace.casterStage);
  const [draft, setDraft] = useState(null);
  const [notice, setNotice] = useState("");
  const [speaking, setSpeaking] = useState([]);
  const [scale, setScale] = useState(0.5);
  const preview = useRef(null);
  const value = draft?.value || settings;
  const dirty = Boolean(draft);
  const disabled =
    !shared || shared.saving || shared.readOnly || shared.changingTournament;
  const output = casterStageOutput({ ...workspace, casterStage: value });
  const outputUrl = new URL("/obs/casters", window.location.origin).href;
  const matches = bracketOutput(workspace.bracket).rounds.flatMap((round) =>
    round.matches
      .filter((match) => match.required !== false && match.status !== "bye")
      .map((match) => ({ ...match, roundName: round.name })),
  );
  useEffect(() => {
    if (!active || !preview.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0) setScale(entry.contentRect.width / 1920);
    });
    observer.observe(preview.current);
    return () => observer.disconnect();
  }, [active]);
  const edit = (key, next) => {
    setDraft((current) => ({
      base: current?.base || JSON.stringify(settings),
      value: { ...(current?.value || settings), [key]: next },
    }));
    setNotice("");
  };
  const editCaster = (slot, key, next) =>
    edit(
      "casters",
      value.casters.map((person, index) =>
        index === slot ? { ...person, [key]: next } : person,
      ),
    );
  const save = () => {
    if (!draft || disabled) return;
    if (draft.base !== JSON.stringify(settings)) {
      setNotice(
        "Another admin changed the caster desk. Discard your draft and review the current settings before saving.",
      );
      return;
    }
    if (value.discordUrl.trim() && !discordVoiceUrl(value.discordUrl)) {
      setNotice(
        "Use the Voice widget URL supplied by streamkit.discord.com/overlay. Other websites and Discord invite links cannot be used here.",
      );
      return;
    }
    if (
      value.casters.some(
        (person) => person.avatar.trim() && !safeImage(person.avatar),
      )
    ) {
      setNotice(
        "Caster avatars need an HTTPS image URL or a PNG, JPEG or WebP data image.",
      );
      return;
    }
    shared.update(["casterStage"], cleanCasterStage(value));
    setDraft(null);
    setNotice(
      "Caster desk saved. Its permanent OBS URL follows the shared settings.",
    );
  };
  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setNotice("Copied.");
    } catch {
      setNotice(
        "Clipboard access is unavailable. Select and copy the URL below.",
      );
    }
  };
  if (!active) return null;
  return (
    <section className="caster-studio">
      <div className="page-heading">
        <div>
          <span className="eyebrow">BEFORE THE FIRST PICK</span>
          <h1>
            Caster desk<span>✦</span>
          </h1>
          <p>
            Introduce the voices of the tournament and show the next matchup
            before the player banners.
          </p>
        </div>
        <span className="caster-studio-status">
          {settings.visible ? "Visible in OBS" : "Hidden in OBS"}
        </span>
      </div>
      {notice && (
        <p className="caster-studio-notice" role="status">
          {notice}
        </p>
      )}
      <section className="caster-studio-card">
        <div className="caster-studio-card-heading">
          <div>
            <h2>Live preview</h2>
            <p>
              {dirty
                ? "Unsaved preview. Save the desk settings to update OBS."
                : "1920 × 1080 · the saved desk follows your current tournament."}
            </p>
          </div>
          <span className="caster-studio-chip">
            {value.visible ? "" : "Hidden on stream · "}Studio preview
          </span>
        </div>
        <div
          className="caster-studio-preview"
          ref={preview}
          style={{ height: scale * 1080 }}
        >
          <div
            className="caster-studio-preview-canvas"
            style={{ transform: `scale(${scale})` }}
          >
            <CasterScreen
              stage={{ ...output, visible: true }}
              preview
              speaking={speaking}
            />
          </div>
        </div>
        {value.layout === "avatars" && (
          <div className="caster-studio-test">
            <span>Speaking glow rehearsal · preview only</span>
            {value.casters.slice(0, value.casterCount).map((person, index) => (
              <button
                className="button secondary"
                type="button"
                key={index}
                aria-pressed={speaking.includes(index)}
                onClick={() =>
                  setSpeaking((current) =>
                    current.includes(index)
                      ? current.filter((item) => item !== index)
                      : [...current, index],
                  )
                }
              >
                {person.name || `Caster ${index + 1}`}
              </button>
            ))}
            <small>
              Static avatars do not detect Discord speech. Use Discord voice
              widget mode for automatic speaking activity in OBS.
            </small>
          </div>
        )}
      </section>
      <fieldset className="caster-studio-card" disabled={disabled}>
        <legend>Desk settings</legend>
        <div className="caster-studio-fields">
          <label>
            Heading
            <input
              value={value.title}
              maxLength={80}
              onChange={(event) => edit("title", event.target.value)}
            />
          </label>
          <label>
            Subtitle
            <input
              value={value.subtitle}
              maxLength={120}
              onChange={(event) => edit("subtitle", event.target.value)}
              placeholder="Optional broadcast message"
            />
          </label>
          <label>
            Presentation
            <select
              value={value.layout}
              onChange={(event) => edit("layout", event.target.value)}
            >
              <option value="avatars">Static caster portraits</option>
              <option value="discord">
                Discord speaking avatars · separate OBS source
              </option>
              <option value="webcams">Webcam windows · captured in OBS</option>
            </select>
          </label>
          <label>
            Caster count
            <select
              value={value.casterCount}
              onChange={(event) =>
                edit("casterCount", Number(event.target.value))
              }
            >
              {[1, 2, 3, 4].map((count) => (
                <option key={count} value={count}>
                  {count}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="caster-studio-checks">
          <label>
            <input
              type="checkbox"
              checked={value.visible}
              onChange={(event) => edit("visible", event.target.checked)}
            />
            Show caster desk in OBS
          </label>
          <label>
            <input
              type="checkbox"
              checked={value.transparent}
              onChange={(event) => edit("transparent", event.target.checked)}
            />
            Transparent background
          </label>
        </div>
        <div className="caster-studio-people">
          {value.casters.slice(0, value.casterCount).map((person, index) => (
            <article key={index}>
              <h3>CASTER 0{index + 1}</h3>
              <label>
                Display name
                <input
                  value={person.name}
                  maxLength={48}
                  onChange={(event) =>
                    editCaster(index, "name", event.target.value)
                  }
                />
              </label>
              <label>
                Role
                <input
                  value={person.role}
                  maxLength={48}
                  placeholder="Play-by-play / Analyst / Host"
                  onChange={(event) =>
                    editCaster(index, "role", event.target.value)
                  }
                />
              </label>
              <label>
                Avatar image URL
                <input
                  type="url"
                  value={person.avatar}
                  maxLength={300000}
                  placeholder="https://…"
                  onChange={(event) =>
                    editCaster(index, "avatar", event.target.value)
                  }
                />
              </label>
            </article>
          ))}
        </div>
        <h2>Upcoming match</h2>
        <div className="caster-studio-fields">
          <label>
            Team source
            <select
              value={value.source}
              onChange={(event) => edit("source", event.target.value)}
            >
              <option value="broadcast">Follow broadcast teams</option>
              <option value="bracket">Choose a bracket match</option>
              <option value="manual">Enter teams manually</option>
            </select>
          </label>
          {value.source === "bracket" && (
            <label>
              Bracket match
              <select
                value={value.matchId}
                onChange={(event) => edit("matchId", event.target.value)}
              >
                <option value="">Choose the upcoming match…</option>
                {matches.map((match) => (
                  <option key={match.id} value={match.id}>
                    {match.roundName}:{" "}
                    {match.teams
                      .map((team) => team?.name || "To be decided")
                      .join(" vs ")}
                  </option>
                ))}
              </select>
            </label>
          )}
          {value.source === "manual" &&
            [0, 1].map((side) => (
              <label key={side}>
                Team {side + 1}
                <input
                  value={value.teams[side].name}
                  maxLength={80}
                  onChange={(event) =>
                    edit(
                      "teams",
                      value.teams.map((team, index) =>
                        index === side
                          ? { ...team, name: event.target.value }
                          : team,
                      ),
                    )
                  }
                />
              </label>
            ))}
        </div>
        {value.source === "broadcast" && (
          <p className="caster-studio-help">
            This follows the current broadcast teams. Choose a bracket match to
            promote a different upcoming fixture.
          </p>
        )}
        {value.layout === "discord" && (
          <div className="caster-studio-setup">
            <h2>Discord voice activity</h2>
            <p>
              Authorize the official{" "}
              <a
                href="https://streamkit.discord.com/overlay"
                target="_blank"
                rel="noreferrer"
              >
                Discord Streamkit Voice widget
              </a>{" "}
              on the production computer, select the caster voice channel and
              paste its installation URL below. Add it as a separate Browser
              Source above the caster desk in OBS. Discord supplies the avatars
              and speaking indicators; this website does not read your call.
            </p>
            <label>
              Streamkit Voice widget URL
              <input
                value={value.discordUrl}
                maxLength={3000}
                placeholder="https://streamkit.discord.com/overlay/voice…"
                onChange={(event) => edit("discordUrl", event.target.value)}
              />
            </label>
            <p>
              The reserved area is x 230, y 270, width 1460, height 490. Set the
              widget's own source size as instructed by Streamkit, then arrange
              it in that area. Keep Discord open and rehearse with the actual
              caster channel.
            </p>
            <p className="caster-studio-help">
              This source is configured on each OBS computer. Saving its URL
              here does not authorize Discord, embed the widget, or connect
              other admins' computers.
            </p>
            <a
              href="https://support.discord.com/hc/en-us/articles/223415707-Using-Discord-s-OBS-Streamkit-Overlay"
              target="_blank"
              rel="noreferrer"
            >
              Official Discord setup guide ↗
            </a>
          </div>
        )}
        {value.layout === "webcams" && (
          <div className="caster-studio-setup">
            <h2>Discord cameras in OBS</h2>
            <p>
              Capture the Discord video-call window in OBS and crop each
              participant into a camera slot. Place those captures below the
              caster desk source; its camera windows are transparent. The
              website does not extract webcam streams from Discord. A local
              webcam can instead use OBS's Video Capture Device source.
            </p>
            <table>
              <thead>
                <tr>
                  <th>Camera</th>
                  <th>X</th>
                  <th>Y</th>
                  <th>Width</th>
                  <th>Height</th>
                </tr>
              </thead>
              <tbody>
                {casterSlots(value.casterCount).map((slot, index) => (
                  <tr key={index}>
                    <td>{index + 1}</td>
                    <td>{Math.round(slot.x)}</td>
                    <td>{slot.y}</td>
                    <td>{Math.round(slot.width)}</td>
                    <td>{slot.height}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="caster-studio-help">
              Coordinates use the original 1920 × 1080 canvas. Crop before
              scaling, keep participant positions stable, and verify the camera
              layout before going on air.
            </p>
            <a
              href="https://obsproject.com/kb/sources-guide"
              target="_blank"
              rel="noreferrer"
            >
              OBS source placement and cropping guide ↗
            </a>
          </div>
        )}
        <div className="caster-studio-actions">
          <button
            type="button"
            className="button primary"
            disabled={!dirty}
            onClick={save}
          >
            Save desk settings
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={!dirty}
            onClick={() => {
              setDraft(null);
              setNotice("");
            }}
          >
            Discard edits
          </button>
        </div>
      </fieldset>
      <section className="caster-studio-card">
        <h2>Permanent OBS source</h2>
        <p>
          Add a Browser Source at 1920 × 1080. Put this scene before the player
          introductions in your OBS running order.
        </p>
        <div className="caster-studio-copy">
          <input aria-label="Caster desk OBS URL" value={outputUrl} readOnly />
          <button
            className="button secondary"
            type="button"
            onClick={() => copy(outputUrl)}
          >
            Copy OBS URL
          </button>
        </div>
        {settings.discordUrl && (
          <div className="caster-studio-copy">
            <input
              aria-label="Saved Discord Voice widget URL"
              value={settings.discordUrl}
              readOnly
            />
            <button
              className="button secondary"
              type="button"
              onClick={() => copy(settings.discordUrl)}
            >
              Copy Discord source
            </button>
          </div>
        )}
      </section>
    </section>
  );
}

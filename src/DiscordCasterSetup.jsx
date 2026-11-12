import { useEffect, useRef, useState } from "react";
import { casterIdsError, fixedCasterCss } from "./discord-caster-css.js";
import CasterScreen from "./CasterScreen.jsx";
import "./DiscordCasterSetup.css";

const exampleIds = [1, 2, 3, 4].map((slot) => `10000000000000000${slot}`);
const guestId = "100000000000000099";

function exampleAvatar(index) {
  const color = ["#5865f2", "#627f91", "#53845e", "#8a698f", "#9a564f"][index];
  return (
    "data:image/svg+xml," +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="${color}"/><circle cx="128" cy="92" r="40" fill="#eee8d7"/><path d="M48 230v-20a80 80 0 0 1 160 0v20" fill="#eee8d7"/></svg>`,
    )
  );
}

function Rehearsal({ stage, count }) {
  const ref = useRef(null);
  const [scale, setScale] = useState(0.5);
  const [guest, setGuest] = useState(false);
  const [reverse, setReverse] = useState(false);
  const [missing, setMissing] = useState(false);
  const [speaking, setSpeaking] = useState([exampleIds[0]]);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0) setScale(entry.contentRect.width / 1920);
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  let room = exampleIds
    .slice(0, count)
    .filter((id) => !(missing && id === exampleIds[1]));
  if (guest) room.unshift(guestId);
  if (reverse) room.reverse();
  const rows = room
    .map((id) => {
      const outsider = id === guestId;
      const index = outsider ? 4 : exampleIds.indexOf(id);
      return `<li class="voice_state${outsider || speaking.includes(id) ? " wrapper_speaking" : ""}" data-userid="${id}"><img class="voice_avatar" alt="${outsider ? "Non-caster guest" : `Example caster ${index + 1}`}" src="${exampleAvatar(index)}"/><div class="voice_username">Example</div></li>`;
    })
    .join("");
  const document = `<style>${fixedCasterCss(count, exampleIds)}</style><div id="root"><div class="voice_container"><ul class="voice_states">${rows}</ul></div></div>`;
  return (
    <details className="discord-caster-rehearsal">
      <summary>Test fixed slots with sample avatars</summary>
      <p>
        Preview only · sample identities and simulated speaking. These controls
        never change OBS or join a Discord call.
      </p>
      <div className="discord-caster-buttons">
        {exampleIds.slice(0, count).map((id, index) => (
          <button
            key={id}
            type="button"
            className="button secondary"
            aria-pressed={speaking.includes(id)}
            onClick={() =>
              setSpeaking((current) =>
                current.includes(id)
                  ? current.filter((value) => value !== id)
                  : [...current, id],
              )
            }
          >
            Caster {index + 1} speaking
          </button>
        ))}
      </div>
      <div className="discord-caster-buttons">
        <button
          type="button"
          className="button secondary"
          aria-pressed={guest}
          onClick={() => setGuest((value) => !value)}
        >
          {guest
            ? "Remove extra participant"
            : "Add extra participant (speaking)"}
        </button>
        <button
          type="button"
          className="button secondary"
          aria-pressed={reverse}
          onClick={() => setReverse((value) => !value)}
        >
          Reverse room order
        </button>
        <button
          type="button"
          className="button secondary"
          disabled={count < 2}
          onClick={() => setMissing((value) => !value)}
        >
          {missing ? "Caster 2 rejoins" : "Caster 2 leaves"}
        </button>
      </div>
      <p className="discord-caster-room">
        Sample room:{" "}
        {room
          .map((id) =>
            id === guestId
              ? "Guest (hidden)"
              : `Caster ${exampleIds.indexOf(id) + 1}`,
          )
          .join(" → ")}
      </p>
      <div
        className="discord-caster-test-preview"
        ref={ref}
        style={{ height: scale * 1080 }}
      >
        <div
          style={{
            width: 1920,
            height: 1080,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
          }}
        >
          <CasterScreen
            stage={{ ...stage, layout: "discord", visible: true }}
          />
          <iframe
            title="Fixed Discord slot rehearsal"
            sandbox=""
            srcDoc={document}
          />
        </div>
      </div>
    </details>
  );
}

export default function DiscordCasterSetup({
  settings,
  stage,
  dirty,
  disabled,
  onUrlChange,
}) {
  const text = useRef(null);
  const [notice, setNotice] = useState(null);
  const ids = settings.casters.map((person) => person.discordUserId);
  const issue = casterIdsError(settings.casterCount, ids);
  const css = issue ? "" : fixedCasterCss(settings.casterCount, ids);
  const blocked = disabled || dirty || Boolean(issue);
  const copy = async () => {
    if (blocked) return;
    try {
      await navigator.clipboard.writeText(css);
      setNotice({
        css,
        text: "Fixed caster CSS copied. Replace the old Custom CSS in the Discord voice source.",
      });
    } catch {
      text.current?.focus();
      text.current?.select();
      setNotice({
        css,
        text: "Clipboard access is unavailable. The CSS is selected below; copy it manually or download it.",
      });
    }
  };
  const download = () => {
    if (blocked) return;
    const url = URL.createObjectURL(new Blob([css], { type: "text/css" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `discord-casters-${settings.casterCount}-fixed.css`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <section className="caster-studio-setup discord-caster-setup">
      <h2>Discord avatars & fixed slots</h2>
      <p>
        Each caster is pinned to their card by Discord user ID. Other people
        stay hidden, even when speaking. Joining, leaving, changing names or
        room order cannot move a caster into another card.
      </p>
      <p className="discord-caster-export-status" role="status">
        {dirty
          ? "Save desk settings before copying CSS so it matches your OBS desk."
          : issue ||
            "Ready to copy · matches the saved caster count and assigned IDs."}
      </p>
      <div className="discord-caster-buttons">
        <button
          type="button"
          className="button primary"
          disabled={blocked}
          onClick={copy}
        >
          Copy fixed CSS
        </button>
        <button
          type="button"
          className="button secondary"
          disabled={blocked}
          onClick={download}
        >
          Download fixed CSS
        </button>
      </div>
      {notice?.css === css && <p role="status">{notice.text}</p>}
      <details className="discord-caster-code">
        <summary>View generated CSS</summary>
        <textarea
          ref={text}
          aria-label="Fixed Discord caster CSS"
          readOnly
          value={dirty ? "" : css}
          placeholder="Enter caster IDs and save the desk settings to generate CSS."
          spellCheck={false}
          rows={9}
        />
      </details>
      <p className="caster-studio-help">
        Caster IDs are saved with this tournament. After changing IDs or caster
        count, save and paste the newly generated CSS into OBS again. A
        disconnected caster leaves their own card empty; the others stay in
        place.
      </p>
      <details className="discord-caster-instructions">
        <summary>OBS setup</summary>
        <ol>
          <li>
            On the OBS computer, authorize the official{" "}
            <a
              href="https://streamkit.discord.com/overlay"
              target="_blank"
              rel="noreferrer"
            >
              Streamkit Voice widget
            </a>{" "}
            and choose the voice channel.
          </li>
          <li>
            Add its URL as a separate Browser Source above the caster-desk
            source.
          </li>
          <li>
            Set the voice source to <strong>1920 × 1080</strong>, position{" "}
            <strong>X 0 / Y 0</strong>, top-left alignment, scale 1, no crop and
            no bounding box.
          </li>
          <li>
            Replace its entire Custom CSS with the generated CSS. Leave{" "}
            <strong>Show Speaking Users Only OFF</strong>.
          </li>
        </ol>
        <p>
          The website saves your configuration; Discord supplies the real
          avatars and speaking activity through the separate OBS source.
        </p>
        <label>
          Streamkit Voice widget URL (optional reference)
          <input
            value={settings.discordUrl}
            maxLength={3000}
            placeholder="https://streamkit.discord.com/overlay/voice…"
            onChange={(event) => onUrlChange(event.target.value)}
          />
        </label>
        <p>
          Saving this URL does not authorize Discord or connect another OBS
          computer.
        </p>
      </details>
      <Rehearsal stage={stage} count={settings.casterCount} />
    </section>
  );
}

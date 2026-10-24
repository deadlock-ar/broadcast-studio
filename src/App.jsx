import { useEffect, useRef, useState } from "react";
import heroes from "./heroes.json";
import { usePickEffects } from "./use-pick-effects";
import { PICK_EFFECT_FADE_MS } from "./pick-effects";
import { createPickFlame } from "./pick-sparks";
import {
  STORAGE_KEY,
  broadcastUrl,
  cleanConfig,
  decodeConfig,
  decodeSnapshot,
  makeDemo,
  openDraftConnection,
  parseDraftCode,
  teamSlots,
} from "./draft";
import "./App.css";
import "./FeedbackUpdates.css";
import StatPanels from "./StatPanels";
import ProductionStudio from "./ProductionStudio";
import SharedOutputs from "./SharedOutputs.jsx";
import Analytics from "./Analytics.jsx";
import TournamentSwitcher from "./TournamentSwitcher.jsx";
import DataLibrary from "./DataLibrary.jsx";
import "./TournamentTools.css";
import { useWorkspace, useWorkspaceField } from "./workspace-context.js";

const roster = Object.fromEntries(heroes.map((h) => [h.id, h]));
const params = new URLSearchParams(window.location.search);
const isOverlay =
  params.get("view") === "overlay" || window.location.pathname === "/obs/draft";
if (isOverlay) document.documentElement.classList.add("broadcast-document");
let saved = {};
try {
  saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
} catch {
  /* first visit */
}
const linkedConfig = decodeConfig(
  new URLSearchParams(window.location.hash.slice(1)).get("config"),
);
const linkedSnapshot = decodeSnapshot(
  new URLSearchParams(window.location.hash.slice(1)).get("state"),
);
const initialConfig = linkedConfig || cleanConfig(saved.config);
const initialCode = isOverlay ? params.get("draft") || "" : saved.code || "";
const blankDraft = () => {
  const d = makeDemo();
  return {
    ...d,
    draftCode: "",
    currentStepIndex: 0,
    status: "WAITING",
    steps: d.steps.map((s) => ({ ...s, heroId: null })),
  };
};

function Icon({ name, size = 18 }) {
  const paths = {
    studio: (
      <>
        <rect x="3" y="3" width="18" height="14" rx="2" />
        <path d="M8 21h8m-4-4v4M8 8h8M8 12h5" />
      </>
    ),
    settings: (
      <>
        <path d="M4 6h16M4 12h16M4 18h16" />
        <circle cx="9" cy="6" r="2" />
        <circle cx="16" cy="12" r="2" />
        <circle cx="8" cy="18" r="2" />
      </>
    ),
    link: (
      <>
        <path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2" />
      </>
    ),
    external: (
      <>
        <path d="M14 3h7v7m0-7L10 14M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5" />
      </>
    ),
    copy: (
      <>
        <rect x="8" y="8" width="12" height="13" rx="2" />
        <path d="M16 8V3H3v13h5" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    play: <path d="m8 4 12 8-12 8z" />,
    help: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4m0 3h.01" />
      </>
    ),
    upload: (
      <>
        <path d="M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6" />
      </>
    ),
    swap: <path d="M3 7h18l-4-4m4 14H3l4 4" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    reset: <path d="M3 10a9 9 0 1 1 2 8M3 3v7h7" />,
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] || paths.studio}
    </svg>
  );
}
function Emblem() {
  return (
    <span className="emblem">
      <img src="/logo.png" alt="Deadlock AR" />
    </span>
  );
}
function Status({ status, mode }) {
  const label =
    mode === "demo"
      ? "Demo preview"
      : mode === "manual"
        ? "Manual draft"
        : {
            live: "Live connection",
            connecting: "Connecting",
            reconnecting: "Reconnecting",
            error: "Connection error",
            idle: "Not connected",
          }[status.state] || "Not connected";
  return (
    <span className={`status ${mode === "live" ? status.state : mode}`}>
      <i />
      {label}
    </span>
  );
}
function TeamMark({ team, number }) {
  return (
    <span className={`team-mark team-${number}`}>
      <span>{team.tag || team.name?.slice(0, 3) || `T${number}`}</span>
      {team.logo && (
        <img
          src={team.logo}
          alt=""
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
      )}
    </span>
  );
}
function PickFlame({ active }) {
  const canvas = useRef(null);
  const renderer = useRef(null);
  useEffect(() => {
    const next = createPickFlame(canvas.current, {
      fadeDurationMs: PICK_EFFECT_FADE_MS,
    });
    renderer.current = next;
    return () => next.dispose();
  }, []);
  useEffect(() => {
    renderer.current?.setActive(active);
  }, [active]);
  return (
    <canvas ref={canvas} className="pick-flame-effect" aria-hidden="true" />
  );
}

function HeroSlot({ slot, index, type, active, flashing, onSelect }) {
  const hero = roster[slot.heroId];
  const image =
    type === "ban" ? hero?.criticalImage || hero?.image : hero?.image;
  const content = (
    <>
      {hero ? (
        <>
          <span className="hero-portrait-frame">
            <img
              className="hero-portrait-normal"
              src={image}
              alt={hero.name}
              onError={(e) => {
                if (e.currentTarget.getAttribute("src") !== hero.image)
                  e.currentTarget.src = hero.image;
              }}
            />
            {type === "pick" && (
              <>
                <img
                  className="hero-portrait-gloat"
                  src={hero.gloatImage || hero.image}
                  alt=""
                  aria-hidden="true"
                  onError={(e) => {
                    if (e.currentTarget.getAttribute("src") !== hero.image)
                      e.currentTarget.src = hero.image;
                  }}
                />
              </>
            )}
          </span>
          {type === "pick" && <PickFlame active={flashing} />}
        </>
      ) : (
        <span className="slot-empty">
          <span className="slot-symbol">{type === "ban" ? "⊘" : "✦"}</span>
          <span>
            {slot.heroId ? `Hero ${slot.heroId}` : `${type} ${index + 1}`}
          </span>
        </span>
      )}
      {hero && <span className="hero-label">{hero.name}</span>}
      {type === "ban" && slot.heroId && <span className="ban-slash" />}
      {active && (
        <span className="active-slot-label">
          {type === "ban" ? "BANNING" : "PICKING"}
        </span>
      )}
    </>
  );
  const cls = `hero-slot ${type} ${slot.heroId ? "filled" : ""} ${active ? "active" : ""} ${flashing ? "new-pick" : ""}`;
  return onSelect ? (
    <button
      className={cls}
      style={{ "--pick-fade-duration": `${PICK_EFFECT_FADE_MS}ms` }}
      onClick={() => onSelect(slot)}
      aria-label={`Edit ${type} ${index + 1}: ${hero?.name || "empty"}`}
    >
      {content}
    </button>
  ) : (
    <div
      className={cls}
      style={{ "--pick-fade-duration": `${PICK_EFFECT_FADE_MS}ms` }}
    >
      {content}
    </div>
  );
}

function DraftBoard({
  config,
  snapshot,
  mode,
  status,
  flashes = {},
  onSelect,
}) {
  const current = snapshot?.steps?.[snapshot.currentStepIndex];
  const active = snapshot?.status === "ACTIVE" ? current : null;
  const firstPick =
    snapshot?.steps?.find((s) => s.selectionType === "pick")?.teamNumber ||
    config.firstPick;
  const teams = config.teams.map((t, i) => {
    const source = snapshot?.teams?.find((s) => s.teamNumber === i + 1);
    return {
      ...t,
      name:
        config.useSourceNames && source?.displayName
          ? source.displayName
          : t.name,
      logo: t.logo || (config.useSourceNames ? source?.teamLogo : ""),
    };
  });
  const timer = snapshot?.currentTimer;
  const seconds = timer?.[`team${timer?.activeTeam}StepTimer`];
  const reserve = timer?.[`team${timer?.activeTeam}ReserveTimer`];
  const time = Number.isFinite(seconds)
    ? `${Math.floor(Math.max(0, seconds) / 60)}:${String(Math.floor(Math.max(0, seconds)) % 60).padStart(2, "0")}`
    : "—";
  const phase =
    snapshot?.status === "COMPLETED"
      ? "Draft complete"
      : snapshot?.status === "PAUSED"
        ? "Draft paused"
        : active
          ? `${teams[active.teamNumber - 1].name} ${active.selectionType === "ban" ? "banning" : "picking"}`
          : "Waiting for the draft";
  const disconnected = mode === "live" && status.state !== "live";
  return (
    <div
      className={`draft-canvas ${config.layout} ${config.transparent ? "transparent" : ""}`}
    >
      <div className="storm storm-one" />
      <div className="storm storm-two" />
      {config.layout === "board" && (
        <div className="broadcast-heading">
          <h2>{config.event}</h2>
          <span className="ornament">──────── ✦ ────────</span>
          <span className="broadcast-round">
            {config.round} <b>•</b> {config.format} <b>•</b> GAME {config.game}
          </span>
        </div>
      )}
      <div className="draft-frame">
        <span className="frame-corner c-tl" />
        <span className="frame-corner c-tr" />
        <span className="frame-corner c-bl" />
        <span className="frame-corner c-br" />
        {[1, 2].map((number) => (
          <section
            className={`draft-team side-${number} ${active?.teamNumber === number ? "taking-turn" : ""}`}
            key={number}
          >
            <div className="draft-team-header">
              <TeamMark team={teams[number - 1]} number={number} />
              <div>
                <h3 dir="auto">{teams[number - 1].name}</h3>
                <span className="team-subtitle">
                  TEAM {number} {firstPick === number && <b>FIRST PICK</b>}
                </span>
              </div>
              <strong className="team-score">{teams[number - 1].score}</strong>
            </div>
            <div className="draft-group-label">
              <b>HERO PICKS</b>
              <span>
                {
                  teamSlots(snapshot, number, "pick").filter((s) => s.heroId)
                    .length
                }{" "}
                / {teamSlots(snapshot, number, "pick").length}
              </span>
            </div>
            <div className="hero-row">
              {teamSlots(snapshot, number, "pick").map((slot, i) => (
                <HeroSlot
                  slot={slot}
                  index={i}
                  type="pick"
                  key={slot.id}
                  active={active?.id === slot.id}
                  flashing={
                    config.pickEffects && flashes[slot.id] === slot.heroId
                  }
                  onSelect={onSelect}
                />
              ))}
            </div>
            {config.showBans && (
              <div className="ban-row">
                <span>BANS</span>
                {teamSlots(snapshot, number, "ban").map((slot, i) => (
                  <HeroSlot
                    slot={slot}
                    index={i}
                    type="ban"
                    key={slot.id}
                    active={active?.id === slot.id}
                    onSelect={onSelect}
                  />
                ))}
              </div>
            )}
          </section>
        ))}
        <div className="draft-center">
          <Emblem />
          <span className="broadcast-wordmark">
            Deadlock <b>AR</b>
          </span>
          <span className="arabic-brand" lang="ar">
            مجتمع ديدلوك العربي
          </span>
          <span className="center-divider">✦</span>
          {config.layout === "lower" && (
            <span className="lower-match">
              {config.format} · GAME {config.game}
              <small>{config.round}</small>
            </span>
          )}
          <span className="draft-phase">{phase}</span>
          {config.showTimer && mode === "live" && (
            <span className="draft-timer">
              {disconnected ? "—" : time}
              <small>
                {Number.isFinite(reserve) && !disconnected
                  ? `RESERVE ${reserve}s`
                  : "DRAFT TIMER"}
              </small>
            </span>
          )}
        </div>
      </div>
      {config.layout === "board" && (
        <div className="broadcast-footer">
          <span>
            DEADLOCK AR <i>✦</i> COMMUNITY TOURNAMENTS
          </span>
          <span>
            {mode === "demo"
              ? "DEMO • SAMPLE DRAFT"
              : mode === "manual"
                ? "MANUAL DRAFT"
                : disconnected
                  ? "AWAITING LIVE UPDATES"
                  : snapshot?.status === "COMPLETED"
                    ? "DRAFT COMPLETE"
                    : "HERO DRAFT"}
          </span>
        </div>
      )}
      {mode === "demo" && config.layout === "lower" && (
        <div className="demo-watermark">DEMO • SAMPLE DRAFT</div>
      )}
    </div>
  );
}
function Field({ label, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function Toggle({ checked, onChange, label, hint }) {
  return (
    <label className="toggle-row">
      <span>
        <strong>{label}</strong>
        {hint && <small>{hint}</small>}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="switch" aria-hidden="true" />
    </label>
  );
}
function Modal({ title, onClose, children }) {
  const ref = useRef(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const before = document.activeElement;
    ref.current?.focus();
    const key = (e) => {
      if (e.key === "Escape") close.current();
      if (e.key === "Tab") {
        const items = [
          ...ref.current.querySelectorAll("button,input,select,a[href]"),
        ].filter((el) => !el.disabled);
        const first = items[0],
          last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      before?.focus();
    };
  }, []);
  return (
    <div
      className="modal-scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
      >
        <header>
          <h2>{title}</h2>
          <button
            className="icon-button"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

function useTournamentLocal(scope, initial) {
  const [saved, setSaved] = useState({ scope, value: initial });
  return [
    saved.scope === scope ? saved.value : initial,
    (value) => setSaved({ scope, value }),
  ];
}
export default function App() {
  const shared = useWorkspace(),
    cloud = Boolean(shared);
  const [config, setConfig] = useWorkspaceField(["config"], initialConfig);
  const [code, setCode] = useWorkspaceField(["draft", "code"], initialCode);
  const [link, setLink] = useTournamentLocal(
    shared?.data.activeTournamentId,
    code ? `https://statlocker.gg/draft/${code}` : "",
  );
  const [password, setPassword] = useTournamentLocal(
    shared?.data.activeTournamentId,
    "",
  );
  const [activePassword, setActivePassword] = useTournamentLocal(
    shared?.data.activeTournamentId,
    "",
  );
  const initialDemo = isOverlay
    ? params.get("demo") === "1"
    : saved.mode === "demo" && !initialCode;
  const [mode, setMode] = useWorkspaceField(
    ["draft", "mode"],
    initialDemo ? "demo" : initialCode ? "live" : "manual",
  );
  const [snapshot, setSnapshot] = useWorkspaceField(
    ["draft", "snapshot"],
    initialDemo
      ? makeDemo()
      : isOverlay && linkedSnapshot
        ? linkedSnapshot
        : saved.snapshot?.draftCode === initialCode
          ? saved.snapshot
          : blankDraft(),
  );
  const initialSnapshots = useRef(new WeakSet());
  const {
    flashes,
    previewSound,
    soundBlocked,
    enableSound,
    togglePreviewSound,
    audioRef,
  } = usePickEffects(
    snapshot,
    `${shared?.data.activeTournamentId || ""}:${mode}:${code}`,
    initialSnapshots,
    config,
    isOverlay,
  );
  const [status, setStatus] = useWorkspaceField(["draft", "status"], {
    state: "idle",
    message: "Paste a draft link to connect.",
  });
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [toast, setToast] = useState("");
  const [activity, setActivity] = useState([]);
  const [tab, setTab] = useState(
    ["stats", "live", "outputs", "analytics", "data"].includes(
      params.get("tab"),
    )
      ? params.get("tab")
      : "studio",
  );
  const [guide, setGuide] = useState(false);
  const [picker, setPicker] = useState(null);
  const [search, setSearch] = useState("");
  const [retry, setRetry] = useState(0);
  const last = useRef(null);
  const stageRef = useRef(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    if (!stageRef.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setScale(entry.contentRect.width / 1920),
    );
    observer.observe(stageRef.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (cloud || !code) return;
    return openDraftConnection(
      code,
      {
        onStatus: setStatus,
        onSnapshot: (next, { initial }) => {
          if (initial) initialSnapshots.current.add(next);
          const old = last.current;
          const changes = next.steps.filter(
            (s) =>
              s.heroId &&
              old?.steps?.find((p) => p.id === s.id)?.heroId !== s.heroId,
          );
          if (changes.length)
            setActivity((a) =>
              [
                ...changes
                  .map((s) => ({
                    id: `${s.id}-${Date.now()}`,
                    time: new Date().toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    }),
                    text: `Team ${s.teamNumber} ${s.selectionType === "ban" ? "banned" : "picked"} ${roster[s.heroId]?.name || `Hero ${s.heroId}`}`,
                  }))
                  .reverse(),
                ...a,
              ].slice(0, 30),
            );
          last.current = next;
          setSnapshot(next);
        },
        onTimer: (timer) =>
          setSnapshot((s) => ({
            ...s,
            currentTimer: { ...s.currentTimer, ...timer },
          })),
        onNotice: setToast,
      },
      { password: activePassword },
    );
  }, [cloud, code, retry, activePassword, setStatus, setSnapshot]);
  useEffect(() => {
    if (isOverlay || cloud) return;
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ config, code, mode, snapshot }),
      );
    } catch {
      queueMicrotask(() =>
        setSaveError(
          "Browser storage is full. Export a backup to keep your settings.",
        ),
      );
    }
  }, [cloud, config, code, mode, snapshot]);
  useEffect(() => {
    if (!isOverlay || cloud) return;
    const handler = (event) => {
      if (event.key === STORAGE_KEY && event.newValue) {
        try {
          const data = JSON.parse(event.newValue);
          setConfig(cleanConfig(data.config));
          if (!params.get("draft") && !params.get("demo"))
            setSnapshot(data.snapshot || blankDraft());
        } catch {
          /* malformed storage */
        }
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, [cloud, setConfig, setSnapshot]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 6000);
    return () => clearTimeout(t);
  }, [toast]);
  const update = (key, value) => setConfig((c) => ({ ...c, [key]: value }));
  const updateTeam = (i, key, value) =>
    setConfig((c) => ({
      ...c,
      teams: c.teams.map((t, j) => (j === i ? { ...t, [key]: value } : t)),
    }));
  const url = cloud
    ? new URL("/obs/draft", window.location.origin).href
    : broadcastUrl(
        config,
        code,
        mode === "demo",
        window.location.origin,
        snapshot,
      );
  const connect = (e) => {
    e.preventDefault();
    if (shared) {
      shared
        .command("draft/connect", { mode: "live", code: link, password })
        .then(() => {
          setError("");
          setPassword("");
        })
        .catch((e) => setError(e.message));
      return;
    }
    try {
      const nextCode = parseDraftCode(link);
      setError("");
      if (nextCode !== code) {
        last.current = null;
        setSnapshot(blankDraft());
        setActivity([]);
      }
      setMode("live");
      setActivePassword(password);
      setCode(nextCode);
      setRetry((n) => n + 1);
    } catch (err) {
      setError(err.message);
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setToast("Broadcast URL copied. Add it as an OBS Browser Source.");
    } catch {
      setToast("Copy the broadcast URL from the field below.");
    }
  };
  const demo = () => {
    if (shared) {
      shared
        .command("draft/connect", { mode: "demo" })
        .catch((e) => setToast(e.message));
      return;
    }
    setCode("");
    setMode("demo");
    setSnapshot(makeDemo());
    setActivity([]);
    setToast(
      "Demo loaded. This is sample data, separate from your live draft.",
    );
  };
  const manual = () => {
    if (shared) {
      shared
        .command("draft/connect", { mode: "manual" })
        .catch((e) => setToast(e.message));
      return;
    }
    setCode("");
    setMode("manual");
    setSnapshot((s) =>
      mode === "demo"
        ? blankDraft()
        : { ...s, status: "WAITING", draftCode: "" },
    );
    setStatus({
      state: "idle",
      message: "Manual mode. Click a hero slot to edit it.",
    });
    setToast("Manual mode enabled. Click a hero slot in the preview.");
  };
  const testPick = () => {
    const next = snapshot.steps.findIndex((step) => !step.heroId);
    if (next < 0) {
      const reset = makeDemo();
      initialSnapshots.current.add(reset);
      setSnapshot(reset);
      setToast("Demo reset. Press Test pick again.");
      return;
    }
    const used = new Set(snapshot.steps.map((step) => step.heroId));
    const hero = heroes.find((hero) => !used.has(hero.id));
    const steps = snapshot.steps.map((step, index) =>
      index === next ? { ...step, heroId: hero.id } : step,
    );
    const currentStepIndex = steps.findIndex((step) => !step.heroId);
    setSnapshot({
      ...snapshot,
      steps,
      currentStepIndex: currentStepIndex < 0 ? steps.length : currentStepIndex,
      status: currentStepIndex < 0 ? "COMPLETED" : "ACTIVE",
    });
  };
  const selectHero = (heroId) => {
    if (shared) {
      shared
        .command("draft/manual", { stepId: picker.id, heroId })
        .catch((e) => setToast(e.message));
      setPicker(null);
      return;
    }
    setSnapshot((s) => {
      const d = s || blankDraft();
      return {
        ...d,
        draftCode: "",
        steps: d.steps.map((step) =>
          step.id === picker.id ? { ...step, heroId } : step,
        ),
        status: "WAITING",
      };
    });
    setMode("manual");
    setPicker(null);
  };
  const uploadLogo = async (i, file) => {
    if (!file) return;
    if (
      !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
      file.size > 5 * 1024 * 1024
    ) {
      setToast("Choose a PNG, JPEG, or WebP logo under 5 MB.");
      return;
    }
    const fileUrl = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = fileUrl;
      await image.decode();
      const canvas = document.createElement("canvas");
      const ratio = Math.min(256 / image.width, 256 / image.height, 1);
      canvas.width = Math.round(image.width * ratio);
      canvas.height = Math.round(image.height * ratio);
      canvas
        .getContext("2d")
        .drawImage(image, 0, 0, canvas.width, canvas.height);
      updateTeam(i, "logo", canvas.toDataURL("image/webp", 0.85));
      setToast("Team logo updated.");
    } catch {
      setToast("That image could not be opened. Try another file.");
    } finally {
      URL.revokeObjectURL(fileUrl);
    }
  };
  const backup = () => {
    const blob = new Blob([JSON.stringify({ version: 1, config }, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "deadlock-ar-settings.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const restore = async (file) => {
    if (!file) return;
    try {
      if (file.size > 1000000) throw new Error();
      const data = JSON.parse(await file.text());
      if (data.version !== 1 || !data.config) throw new Error();
      setConfig(cleanConfig(data.config));
      setToast("Settings restored.");
    } catch {
      setToast("Choose a Deadlock AR settings backup.");
    }
  };
  if (isOverlay)
    return (
      <main
        className={`overlay-page ${config.transparent ? "transparent" : ""}`}
        ref={stageRef}
      >
        <audio ref={audioRef} hidden preload="auto" />
        <div
          className="overlay-scaled"
          style={{ transform: `scale(${scale})` }}
        >
          <DraftBoard
            config={config}
            snapshot={snapshot}
            mode={mode}
            status={status}
            flashes={flashes}
          />
        </div>
        {config.voiceLines && soundBlocked && (
          <button
            className="enable-broadcast-sound button primary"
            onClick={enableSound}
          >
            Enable sound
          </button>
        )}
      </main>
    );

  return (
    <div className="studio-app">
      <audio ref={audioRef} hidden preload="auto" />
      <aside className="sidebar">
        <a className="sidebar-brand" href="/">
          <Emblem />
          <span>
            Deadlock <b>AR</b>
            <small>TOURNAMENT STUDIO</small>
          </span>
        </a>
        <span className="sidebar-section">WORKSPACE</span>
        <nav>
          <button
            className={tab === "studio" ? "selected" : ""}
            onClick={() => setTab("studio")}
          >
            <Icon name="studio" />
            Draft studio<span>01</span>
          </button>
          {tab === "stats" && (
            <button
              className={tab === "stats" ? "selected" : ""}
              onClick={() => setTab("stats")}
            >
              <Icon name="settings" />
              API stats
            </button>
          )}
          <button
            className={tab === "live" ? "selected" : ""}
            onClick={() => setTab("live")}
          >
            <Icon name="play" />
            Live desk<span>02</span>
          </button>
          <button
            className={tab === "settings" ? "selected" : ""}
            onClick={() => setTab("settings")}
          >
            <Icon name="settings" />
            Broadcast settings
          </button>
          <button onClick={() => setGuide(true)}>
            <Icon name="help" />
            Setup guide
          </button>
          {cloud && (
            <button
              className={tab === "analytics" ? "selected" : ""}
              onClick={() => setTab("analytics")}
            >
              <Icon name="settings" />
              Tournament reports
            </button>
          )}
          {cloud && (
            <button
              className={tab === "outputs" ? "selected" : ""}
              onClick={() => setTab("outputs")}
            >
              <Icon name="external" />
              OBS outputs
            </button>
          )}
          {cloud && (
            <button
              className={tab === "data" ? "selected" : ""}
              onClick={() => setTab("data")}
            >
              <Icon name="settings" />
              Data library
            </button>
          )}
          {shared?.logout && <button onClick={shared.logout}>Sign out</button>}
        </nav>
        <div className="sidebar-bottom">
          <span className="sidebar-star">✦</span>
          <strong>Made for the community.</strong>
          <span lang="ar">مجتمع ديدلوك العربي</span>
          <div className="sidebar-admin">
            <span>AR</span>
            <div>
              Broadcast admin
              <small>{cloud ? "SHARED WORKSPACE" : "LOCAL WORKSPACE"}</small>
            </div>
            <i />
          </div>
        </div>
      </aside>
      <main className="workspace">
        <header className="workspace-bar">
          <span>
            DEADLOCK AR <span className="bar-slash">/</span> TOURNAMENT
            OPERATIONS
          </span>
          <span className="save-state">
            <Icon name="check" size={14} />
            {cloud
              ? shared.saving
                ? "Saving shared changes…"
                : !shared.connected
                  ? "Reconnecting…"
                  : shared.error
                    ? "Changes need attention"
                    : "Shared studio connected"
              : saveError
                ? "Backup recommended"
                : "Saved in this browser"}
          </span>
        </header>
        {cloud && <TournamentSwitcher />}
        <div
          inert={shared?.changingTournament || undefined}
          aria-busy={shared?.changingTournament || undefined}
          className={`workspace-content${tab === "stats" ? " stats-tab" : tab === "live" ? " production-tab" : tab === "outputs" ? " outputs-tab" : tab === "analytics" ? " analytics-tab" : tab === "data" ? " data-tab" : tab === "settings" ? " settings-only" : ""}`}
        >
          <StatPanels
            key={shared?.data.activeTournamentId}
            config={config}
            active={tab === "stats"}
          />
          <ProductionStudio
            key={shared?.data.activeTournamentId}
            config={config}
            active={tab === "live"}
          />
          {cloud && (
            <Analytics
              key={shared.data.activeTournamentId}
              config={config}
              active={tab === "analytics"}
            />
          )}
          {cloud && (
            <DataLibrary
              key={shared.data.activeTournamentId}
              active={tab === "data"}
            />
          )}
          {cloud && <SharedOutputs />}
          <div className="page-heading">
            <div>
              <span className="eyebrow">THE BROADCAST STARTS HERE</span>
              <h1>
                {tab === "studio" ? "Draft studio" : "Broadcast settings"}
                <span>✦</span>
              </h1>
              <p>
                {tab === "studio"
                  ? "Your community. Your identity. Every pick, live."
                  : "Make the draft screen fit your stream."}
              </p>
            </div>
            <a
              className="button primary"
              href={url}
              target="_blank"
              rel="noreferrer"
            >
              <Icon name="external" />
              Open broadcast
            </a>
          </div>
          <div className="main-grid">
            <section className="preview-panel">
              <div className="panel-toolbar">
                <div>
                  <span className="eyebrow">BROADCAST PREVIEW</span>
                  <Status status={status} mode={mode} />
                </div>
                <div className="segmented" aria-label="Broadcast layout">
                  <button
                    className={config.layout === "board" ? "selected" : ""}
                    onClick={() => update("layout", "board")}
                  >
                    Full board
                  </button>
                  <button
                    className={config.layout === "lower" ? "selected" : ""}
                    onClick={() => update("layout", "lower")}
                  >
                    Lower third
                  </button>
                </div>
              </div>
              <div className="preview-stage" ref={stageRef}>
                <div
                  className="preview-scaled"
                  style={{ transform: `scale(${scale})` }}
                >
                  <DraftBoard
                    config={config}
                    snapshot={snapshot}
                    mode={mode}
                    status={status}
                    flashes={flashes}
                    onSelect={
                      mode === "manual"
                        ? (slot) => {
                            setPicker({
                              ...slot,
                              tournamentId: shared?.data.activeTournamentId,
                            });
                            setSearch("");
                          }
                        : null
                    }
                  />
                </div>
              </div>
              <footer className="preview-footer">
                <span>
                  <i />
                  1920 × 1080 <b>·</b> OBS Browser Source
                </span>
                <div className="preview-actions">
                  <button
                    className="text-button"
                    disabled={!config.voiceLines}
                    onClick={togglePreviewSound}
                  >
                    {previewSound ? "Mute preview" : "Preview sound"}
                  </button>
                  {mode === "demo" && (
                    <button className="text-button" onClick={testPick}>
                      Test pick
                    </button>
                  )}
                  <button
                    className="text-button"
                    onClick={mode === "demo" ? manual : demo}
                  >
                    <Icon name={mode === "demo" ? "reset" : "play"} size={14} />
                    {mode === "demo" ? "Exit demo" : "Load demo"}
                  </button>
                </div>
              </footer>
            </section>
            <aside className="connection-panel">
              <div className="connection-heading">
                <span className="connection-icon">
                  <Icon name="link" size={22} />
                </span>
                <span className="eyebrow">LIVE DATA SOURCE</span>
                <h2>Connect the draft</h2>
                <p>
                  Paste your Statlocker link. Picks and bans update
                  automatically.
                </p>
              </div>
              <form onSubmit={connect}>
                {cloud && (
                  <Field label="Manual draft format">
                    <select
                      value={snapshot.banCount || 3}
                      disabled={mode === "live"}
                      onChange={(e) =>
                        shared
                          .command("draft/rule", {
                            banCount: Number(e.target.value),
                          })
                          .catch((e) => setError(e.message))
                      }
                    >
                      <option value={3}>Competitive · 3 bans per team</option>
                      <option value={2}>Classic · 2 bans per team</option>
                    </select>
                    <small>
                      Changing format saves the current draft and starts an
                      empty board. Live rooms use their own order.
                    </small>
                  </Field>
                )}
                <Field label="Statlocker draft link">
                  <input
                    type="text"
                    placeholder="https://statlocker.gg/draft/…"
                    aria-label="Statlocker draft link"
                    value={link}
                    onChange={(e) => setLink(e.target.value)}
                  />
                </Field>
                <details className="password-option">
                  <summary>Password-protected draft?</summary>
                  <Field label="Lobby password">
                    <input
                      type="password"
                      autoComplete="off"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </Field>
                </details>
                <button className="button primary full" type="submit">
                  <Icon name="link" size={16} />
                  {code ? "Reconnect draft" : "Connect draft"}
                </button>
                {error && (
                  <p className="inline-error" role="alert">
                    {error}
                  </p>
                )}
              </form>
              <div className={`connection-state ${status.state}`}>
                <Status status={status} mode={mode} />
                <p>
                  {mode === "demo"
                    ? "Sample picks and bans for checking your layout."
                    : mode === "manual"
                      ? "Click a hero slot to make a manual selection."
                      : status.message}
                </p>
                {code && (
                  <div className="source-meta">
                    <span>DRAFT ROOM</span>
                    <a
                      href={`https://statlocker.gg/draft/${code}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {code} ↗
                    </a>
                  </div>
                )}
              </div>
              <div className="connection-note">
                <Icon name="check" size={15} />
                <p>Spectator connection. Draft decisions stay in Statlocker.</p>
              </div>
              {code && (
                <button className="text-button disconnect" onClick={manual}>
                  Disconnect & use manual mode
                </button>
              )}
            </aside>
          </div>
          {tab === "studio" ? (
            <>
              <div className="section-heading">
                <div>
                  <span className="eyebrow">MATCH IDENTITY</span>
                  <h2>Set the stage</h2>
                </div>
                <button
                  className="text-button"
                  onClick={() =>
                    setConfig((c) => ({
                      ...c,
                      teams: [...c.teams].reverse(),
                    }))
                  }
                >
                  <Icon name="swap" size={16} />
                  Swap branding & scores
                </button>
              </div>
              <div className="teams-grid">
                {config.teams.map((team, i) => (
                  <section className="team-editor" key={i}>
                    <header>
                      <span className={`team-dot dot-${i + 1}`} />
                      <span className="eyebrow">
                        {i === 0 ? "LEFT TEAM" : "RIGHT TEAM"}
                      </span>
                      <span className="editor-team-number">0{i + 1}</span>
                    </header>
                    <div className="team-editor-content">
                      <div className="logo-editor">
                        <TeamMark team={team} number={i + 1} />
                        <label className="upload-button">
                          <Icon name="upload" size={13} />
                          Logo
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            aria-label={`Upload team ${i + 1} logo`}
                            onChange={(e) => {
                              uploadLogo(i, e.target.files?.[0]);
                              e.target.value = "";
                            }}
                          />
                        </label>
                        {team.logo && (
                          <button
                            className="text-button small"
                            onClick={() => updateTeam(i, "logo", "")}
                          >
                            Remove
                          </button>
                        )}
                      </div>
                      <div className="team-fields">
                        <Field label={`Team ${i + 1} name`}>
                          <input
                            value={team.name}
                            maxLength={48}
                            dir="auto"
                            onChange={(e) =>
                              updateTeam(i, "name", e.target.value)
                            }
                          />
                        </Field>
                        <div className="team-short-fields">
                          <Field label="Short name">
                            <input
                              value={team.tag}
                              maxLength={5}
                              onChange={(e) =>
                                updateTeam(
                                  i,
                                  "tag",
                                  e.target.value.toUpperCase(),
                                )
                              }
                            />
                          </Field>
                          <Field label={`Team ${i + 1} score`}>
                            <div className="stepper">
                              <button
                                aria-label={`Decrease team ${i + 1} score`}
                                onClick={() =>
                                  updateTeam(
                                    i,
                                    "score",
                                    Math.max(0, team.score - 1),
                                  )
                                }
                              >
                                −
                              </button>
                              <output>{team.score}</output>
                              <button
                                aria-label={`Increase team ${i + 1} score`}
                                onClick={() =>
                                  updateTeam(
                                    i,
                                    "score",
                                    Math.min(99, team.score + 1),
                                  )
                                }
                              >
                                +
                              </button>
                            </div>
                          </Field>
                        </div>
                      </div>
                    </div>
                  </section>
                ))}
              </div>
              <section className="match-editor">
                <Field label="Tournament name">
                  <input
                    value={config.event}
                    maxLength={80}
                    onChange={(e) => update("event", e.target.value)}
                  />
                </Field>
                <Field label="Round / stage">
                  <input
                    value={config.round}
                    maxLength={80}
                    onChange={(e) => update("round", e.target.value)}
                  />
                </Field>
                <Field label="Series format">
                  <select
                    value={config.format}
                    onChange={(e) => update("format", e.target.value)}
                  >
                    {["BO1", "BO3", "BO5", "BO7"].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Game number">
                  <input
                    type="number"
                    min="1"
                    max="99"
                    value={config.game}
                    onChange={(e) =>
                      update(
                        "game",
                        Math.max(1, Math.min(99, Number(e.target.value))),
                      )
                    }
                  />
                </Field>
              </section>
              <div className="activity-panel">
                <div className="section-heading">
                  <h2>Draft activity</h2>
                  <span className="muted">
                    {mode === "live"
                      ? "Latest received selections"
                      : "Live selections appear here"}
                  </span>
                </div>
                {activity.length ? (
                  <ul>
                    {activity.slice(0, 6).map((a) => (
                      <li key={a.id}>
                        <span>✦</span>
                        {a.text}
                        <time>{a.time}</time>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="activity-empty">
                    <Icon name="studio" size={18} />
                    <p>
                      {mode === "demo"
                        ? "Demo preview is active. Connect a room to see live activity."
                        : "Ready when your draft is. Picks and bans will appear as they happen."}
                    </p>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="settings-grid">
              <section className="settings-panel">
                <h2>Optional tools</h2>
                <details>
                  <summary>Legacy API statistics</summary>
                  <p>The API source remains available for older workflows.</p>
                  <button
                    className="button secondary"
                    onClick={() => setTab("stats")}
                  >
                    Open API stats
                  </button>
                </details>
              </section>
              <section className="settings-panel">
                <h2>On-screen details</h2>
                <Toggle
                  checked={config.transparent}
                  onChange={(v) => update("transparent", v)}
                  label="Transparent background"
                  hint="Keep the draft panel over your game or stream scene."
                />
                <Toggle
                  checked={config.showBans}
                  onChange={(v) => update("showBans", v)}
                  label="Show hero bans"
                  hint="Display every ban slot supplied by the draft."
                />
                <Toggle
                  checked={config.showTimer}
                  onChange={(v) => update("showTimer", v)}
                  label="Show live timer"
                  hint="Uses the timer received from Statlocker."
                />
                <Toggle
                  checked={config.useSourceNames}
                  onChange={(v) => update("useSourceNames", v)}
                  label="Use Statlocker team names"
                  hint="Use source names and logos when a custom logo is not set."
                />
              </section>
              <section className="settings-panel">
                <h2>Workspace backup</h2>
                <p>
                  {cloud
                    ? "Names, logos, scores and presentation are shared and saved on the server. Export settings for an additional copy. Importing replaces the shared branding."
                    : "Settings are saved in this browser. Export a backup to move them to another browser."}
                </p>
                <div className="backup-actions">
                  <button className="button secondary" onClick={backup}>
                    <Icon name="upload" />
                    Export settings
                  </button>
                  <label className="button secondary">
                    Import settings
                    <input
                      className="hidden-input"
                      type="file"
                      accept="application/json,.json"
                      onChange={(e) => {
                        restore(e.target.files?.[0]);
                        e.target.value = "";
                      }}
                    />
                  </label>
                </div>
                <div className="identity-swatches">
                  <span style={{ background: "#EAE1CF" }} />
                  <span style={{ background: "#292B27" }} />
                  <span style={{ background: "#65734F" }} />
                  <span style={{ background: "#809064" }} />
                  <span style={{ background: "#9EA982" }} />
                </div>
                <small>PARCHMENT & OLIVE · DEADLOCK AR IDENTITY</small>
              </section>
              <section className="settings-panel">
                <h2>Pick effects & sound</h2>
                <Toggle
                  checked={config.pickEffects}
                  onChange={(v) => update("pickEffects", v)}
                  label="On-fire pick animation"
                  hint="Show the hero’s gloat portrait with a light-blue glow for six seconds, then fade smoothly to normal."
                />
                <Toggle
                  checked={config.voiceLines}
                  onChange={(v) => update("voiceLines", v)}
                  label="Hero selection voice lines"
                  hint="Play one game voice line for each new pick in the broadcast."
                />
                <Field label={`Voice volume · ${config.voiceVolume}%`}>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={config.voiceVolume}
                    onChange={(e) =>
                      update("voiceVolume", Number(e.target.value))
                    }
                    aria-label="Voice volume"
                  />
                </Field>
                <p>
                  Use Preview sound and Test pick in demo mode to check audio.
                  The studio starts muted so it can stay open beside OBS. In
                  OBS, enable “Control audio via OBS” on the Browser Source.
                </p>
                {!isOverlay && soundBlocked && (
                  <button className="button secondary" onClick={enableSound}>
                    Enable preview sound
                  </button>
                )}
              </section>
            </div>
          )}
          <section className="broadcast-link-panel">
            <span className="broadcast-link-icon">
              <Icon name="external" size={23} />
            </span>
            <div>
              <span className="eyebrow">READY FOR YOUR STREAM</span>
              <h2>Your broadcast, one link away.</h2>
              <p>
                {cloud
                  ? "Add this permanent URL to OBS at 1920 × 1080. It follows the shared draft and branding automatically."
                  : "Add this URL to OBS as a 1920 × 1080 Browser Source. Generate a new URL after changing branding."}
              </p>
              <input
                className="broadcast-url"
                value={url}
                readOnly
                aria-label="Broadcast URL"
                onFocus={(e) => e.target.select()}
              />
            </div>
            <button className="button primary" onClick={copy}>
              <Icon name="copy" />
              Copy OBS URL
            </button>
          </section>
          <footer className="workspace-footer">
            <span>
              DEADLOCK AR <i>✦</i> TOURNAMENT STUDIO
            </span>
            <button className="text-button" onClick={() => setGuide(true)}>
              Need help setting up? ↗
            </button>
          </footer>
        </div>
      </main>
      {(toast || saveError) && (
        <div className="toast" role="status">
          <Icon name="check" />
          {toast || saveError}
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => {
              setToast("");
              setSaveError("");
            }}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      )}
      {guide && (
        <Modal
          title="From draft room to live stream"
          onClose={() => setGuide(false)}
        >
          <ol className="guide-steps">
            <li>
              <b>Connect your room</b>
              <p>
                Paste a Statlocker draft link and press Connect. Private rooms
                also need their lobby password. The app joins as a spectator.
              </p>
            </li>
            <li>
              <b>Set your match identity</b>
              <p>
                Edit names, upload logos, and set the series score and round.
                {cloud
                  ? "Load demo replaces the shared draft output with a rehearsal. All connected OBS views follow it."
                  : "Use Load demo to check hero artwork without affecting your live room."}
              </p>
            </li>
            <li>
              <b>Add the broadcast to OBS</b>
              <p>
                Copy the OBS URL. Create a Browser Source at 1920 × 1080, paste
                the URL, and enable “Refresh browser when scene becomes active”.
                Enable “Control audio via OBS” for hero voice lines. Choose
                Lower third and Transparent background for an overlay.
              </p>
            </li>
            <li>
              <b>Update branding when needed</b>
              <p>
                {cloud
                  ? "All authorized admins share one workspace. Changes to names, logos, scores and presentation update the same permanent OBS links."
                  : "The URL carries a copy of names, logos and scores. Copy a new URL after editing those."}
              </p>
            </li>
          </ol>
          <div className="guide-note">
            {cloud
              ? "Draft connections run in the cloud as spectators. Lobby passwords stay in server memory, and are never stored in the shared settings or OBS links. After a server restart, reconnect private drafts with their password."
              : "This version stores settings in your browser. Shared control needs the hosted studio."}
          </div>
        </Modal>
      )}
      {picker &&
        (!cloud || picker.tournamentId === shared.data.activeTournamentId) && (
          <Modal
            title={`Choose a hero · Team ${picker.teamNumber} ${picker.selectionType}`}
            onClose={() => setPicker(null)}
          >
            <input
              className="hero-search"
              placeholder="Search heroes…"
              aria-label="Search heroes"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="hero-picker">
              {heroes
                .filter((h) =>
                  h.name.toLowerCase().includes(search.toLowerCase()),
                )
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((h) => {
                  const used = snapshot.steps.some(
                    (s) => s.id !== picker.id && s.heroId === h.id,
                  );
                  return (
                    <button
                      key={h.id}
                      onClick={() => selectHero(h.id)}
                      disabled={used}
                    >
                      <img src={h.image} alt="" />
                      <span>{h.name}</span>
                      {used && <small>Already selected</small>}
                    </button>
                  );
                })}
            </div>
            <button
              className="button secondary"
              onClick={() => selectHero(null)}
            >
              Clear this slot
            </button>
          </Modal>
        )}
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import App from "./App.jsx";
import { Hud, Scoreboard, SeriesMvp } from "./ProductionStudio.jsx";
import { StatGraphic } from "./StatPanels.jsx";
import ultimateCatalog from "../collector/data/ultimates.json";
import {
  OUTPUTS,
  initialWorkspace,
  diffFields,
  applyOperations,
  getAt,
} from "./workspace-model.js";
import { cleanPanel } from "./stats.js";
import { enqueueCollectorState } from "./collector.js";
import { WorkspaceContext, workspaceRequest } from "./workspace-context.js";
import "./CloudStudio.css";

function WorkspaceProvider({ initial, children, logout }) {
  const canonical = useRef(initial),
    pending = useRef([]),
    sending = useRef(false);
  const [data, setData] = useState(initial),
    [error, setError] = useState(""),
    [connected, setConnected] = useState(true),
    [saving, setSaving] = useState(false);
  const refresh = useCallback(() => {
    let value = canonical.current;
    for (const task of pending.current)
      value = applyOperations(value, task.operations, false);
    setData(value);
    setSaving(pending.current.length > 0);
  }, []);
  const drain = useCallback(async () => {
    if (sending.current) return;
    sending.current = true;
    while (pending.current.length) {
      const task = pending.current[0];
      try {
        let value;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            value = await workspaceRequest("workspace", task);
            break;
          } catch (e) {
            if (e.status || attempt) throw e;
          }
        }
        if (value.revision > canonical.current.revision)
          canonical.current = value;
        pending.current.shift();
        setError("");
      } catch (e) {
        if (e.workspace) canonical.current = e.workspace;
        pending.current = [];
        setError(e.message);
        if (e.status === 401) logout();
      }
      refresh();
    }
    sending.current = false;
  }, [refresh, logout]);
  const update = useCallback(
    (path, updater) => {
      let current = canonical.current;
      for (const task of pending.current)
        current = applyOperations(current, task.operations, false);
      const before = getAt(current, path),
        value = typeof updater === "function" ? updater(before) : updater;
      const operations = diffFields(before, value, path);
      if (!operations.length) return;
      pending.current.push({ id: crypto.randomUUID(), operations });
      refresh();
      void drain();
    },
    [refresh, drain],
  );
  const command = useCallback(
    async (path, value = {}) => {
      const result = await workspaceRequest(path, value);
      if (result.config && result.revision >= canonical.current.revision) {
        canonical.current = result;
        refresh();
      }
      return result;
    },
    [refresh],
  );
  useEffect(() => {
    const events = new EventSource("/api/workspace/events");
    events.onmessage = (e) => {
      try {
        const value = JSON.parse(e.data);
        if (value.revision >= canonical.current.revision) {
          canonical.current = value;
          refresh();
        }
        setConnected(true);
      } catch {
        setError("Invalid workspace update. Reload to reconnect.");
      }
    };
    events.onerror = () => setConnected(false);
    return () => events.close();
  }, [refresh]);
  return (
    <WorkspaceContext.Provider
      value={{ data, update, command, logout, error, connected, saving }}
    >
      {children}
      {error && (
        <div className="cloud-error" role="alert">
          {error}
          <button onClick={() => setError("")}>Dismiss</button>
        </div>
      )}
    </WorkspaceContext.Provider>
  );
}
function BroadcastFrame({ children }) {
  const ref = useRef(null),
    [scale, setScale] = useState(window.innerWidth / 1920);
  useEffect(() => {
    document.documentElement.classList.add("production-broadcast-document");
    const observer = new ResizeObserver(([e]) =>
      setScale(e.contentRect.width / 1920),
    );
    if (ref.current) observer.observe(ref.current);
    return () => {
      observer.disconnect();
      document.documentElement.classList.remove(
        "production-broadcast-document",
      );
    };
  }, []);
  return (
    <main className="production-overlay" ref={ref}>
      <div
        className="production-scaled"
        style={{ transform: `scale(${scale})` }}
      >
        {children}
      </div>
    </main>
  );
}
function CloudBroadcast({ channel }) {
  const [value, setValue] = useState(null),
    [error, setError] = useState(false),
    [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    let queue = [],
      identity = null,
      delay = null;
    const source = new EventSource(`/api/broadcast/events?channel=${channel}`);
    source.onmessage = (e) => {
      try {
        const next = JSON.parse(e.data),
          nextDelay = next.session?.settings.delayMs || 0;
        if (
          next.session?.id !== identity ||
          nextDelay !== delay ||
          next.visible === false
        ) {
          queue = [];
          identity = next.session?.id;
          delay = nextDelay;
          if (["deadem", "ultimates"].includes(channel)) setValue(null);
        }
        if (
          nextDelay &&
          next.visible !== false &&
          ["deadem", "ultimates"].includes(channel)
        )
          queue = enqueueCollectorState(queue, next, Date.now(), nextDelay);
        else setValue(next);
        setError(false);
      } catch {
        setError(true);
      }
    };
    source.onerror = () => setError(true);
    const timer = setInterval(() => {
      let next;
      while (queue[0]?.at <= Date.now()) next = queue.shift().value;
      if (next) setValue(next);
    }, 40);
    return () => {
      source.close();
      clearInterval(timer);
    };
  }, [channel]);
  if (channel === "draft") {
    if (!value) return null;
    const data = { ...initialWorkspace(), ...value };
    if (error)
      data.draft = {
        ...data.draft,
        status: {
          state: "reconnecting",
          message: "Studio connection lost · last draft retained.",
        },
      };
    return (
      <WorkspaceContext.Provider value={{ data, readOnly: true }}>
        <App />
      </WorkspaceContext.Provider>
    );
  }
  const result = value?.apiStats?.result,
    session = value?.session;
  const match =
    channel === "live-events"
      ? result?.match
      : session?.match
        ? {
            ...session.match,
            heroInfo: Object.fromEntries(
              ultimateCatalog.map((h) => [
                h.heroId,
                { name: h.heroName, image: h.heroImage },
              ]),
            ),
          }
        : null;
  const panel = cleanPanel(
    channel === "live-events" ? value?.apiStats?.panel : value?.panel,
  );
  const visible =
    channel === "live-events" ? value?.apiStats?.visible : value?.visible;
  return (
    <BroadcastFrame>
      {visible === false ? null : channel === "scoreboard" ? (
        value?.kind === "mvp" ? (
          <SeriesMvp result={value.mvp} />
        ) : (
          <Scoreboard result={value?.scoreboard} />
        )
      ) : channel === "ultimates" ? (
        <Hud
          session={error ? null : session}
          catalog={ultimateCatalog}
          delayed
        />
      ) : match ? (
        <StatGraphic
          match={match}
          panel={panel}
          time={
            channel === "live-events"
              ? (value.apiStats.time ?? match.duration)
              : match.duration
          }
          status={
            channel === "live-events"
              ? result.status
              : session.ended
                ? "finished"
                : session.status
          }
          stale={
            error ||
            (session &&
              !session.ended &&
              (session.status !== "live" ||
                now - session.updatedAt >
                  15000 + (session.settings.delayMs || 0))) ||
            (channel === "live-events" &&
              value.apiStats.source?.mode === "live" &&
              (result.status !== "live" || now - result.updated > 15000))
          }
        />
      ) : null}
    </BroadcastFrame>
  );
}
function Login({ onLogin }) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <main className="cloud-login">
      <section>
        <img src="/logo.png" alt="Deadlock AR" />
        <span className="eyebrow">DEADLOCK AR / BROADCAST STUDIO</span>
        <h1>
          One studio.
          <br />
          <em>The whole broadcast.</em>
        </h1>
        <p>
          Sign in to manage the shared draft, statistics and on-air graphics.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget;
            setBusy(true);
            setError("");
            try {
              await workspaceRequest("login", {
                password: new FormData(form).get("password"),
              });
              form.reset();
              onLogin();
            } catch (e) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Admin password
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              maxLength={512}
            />
          </label>
          {error && <p role="alert">{error}</p>}
          <button className="button primary" disabled={busy}>
            {busy ? "Signing in…" : "Open shared studio →"}
          </button>
        </form>
        <small>
          OBS outputs use their permanent links and do not require an admin
          login.
        </small>
      </section>
    </main>
  );
}
export default function CloudStudio({ legacy }) {
  const [state, setState] = useState({ phase: "loading" }),
    [attempt, setAttempt] = useState(0);
  const channel = Object.keys(OUTPUTS).find(
    (k) => OUTPUTS[k] === window.location.pathname,
  );
  const load = useCallback(() => setAttempt((n) => n + 1), []);
  const logout = useCallback(() => {
    void workspaceRequest("logout", {}).finally(() =>
      setState({ phase: "login" }),
    );
  }, []);
  useEffect(() => {
    let stopped = false;
    (async () => {
      try {
        const response = await fetch("/api/auth");
        if (
          response.status === 404 ||
          !response.headers.get("content-type")?.includes("application/json")
        ) {
          if (!stopped) setState({ phase: "legacy" });
          return;
        }
        if (!response.ok) throw Error("The studio is starting. Please retry.");
        const auth = await response.json();
        globalThis.__DLAR_CLOUD__ = true;
        if (channel) {
          if (!stopped) setState({ phase: "broadcast" });
          return;
        }
        if (!auth.authenticated) {
          if (!stopped) setState({ phase: "login" });
          return;
        }
        const initial = await workspaceRequest("workspace");
        if (!stopped) setState({ phase: "studio", initial });
      } catch (e) {
        if (!stopped) setState({ phase: "error", message: e.message });
      }
    })();
    return () => {
      stopped = true;
    };
  }, [attempt, channel]);
  useEffect(() => {
    if (!channel || state.phase !== "error") return;
    // OBS must recover from a Railway cold start without a manual refresh.
    const timer = setTimeout(load, 5000);
    return () => clearTimeout(timer);
  }, [channel, state.phase, load]);
  if (state.phase === "legacy") return legacy;
  if (state.phase === "broadcast") return <CloudBroadcast channel={channel} />;
  if (state.phase === "login") return <Login onLogin={load} />;
  if (state.phase === "studio")
    return (
      <WorkspaceProvider initial={state.initial} logout={logout}>
        <App />
      </WorkspaceProvider>
    );
  if (channel) return null;
  return (
    <main className="cloud-loading">
      <h1>Deadlock AR</h1>
      <p>{state.message || "Connecting to the broadcast studio…"}</p>
      {state.phase === "error" && (
        <button className="button primary" onClick={load}>
          Retry connection
        </button>
      )}
    </main>
  );
}

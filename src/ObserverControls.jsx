import { useEffect, useState } from "react";
import { workspaceRequest } from "./workspace-context.js";
export default function ObserverControls({ active }) {
  const [publishers, setPublishers] = useState([]),
    [pair, setPair] = useState(null),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    let alive = true;
    const refresh = () =>
      workspaceRequest("publisher/status")
        .then((v) => {
          if (alive) {
            setPublishers(v.publishers);
            setNow(Date.now());
          }
        })
        .catch((e) => {
          if (alive) setNotice(e.message);
        });
    refresh();
    const timer = setInterval(refresh, 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [active]);
  const command = async (route, value) => {
    setBusy(true);
    try {
      const result = await workspaceRequest(route, value);
      setNotice("");
      return result;
    } catch (e) {
      setNotice(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="production-card observer-connect">
      <div>
        <span className="eyebrow">PRIMARY SOURCE / OBSERVER PC</span>
        <h2>Connect a local recording.</h2>
        <p>
          The observer joins the lobby before the match, records locally, and
          runs the companion. The studio receives stats over a secure outbound
          connection.
        </p>
      </div>
      <div className="observer-steps">
        <div>
          <b>01</b>
          <h3>Download once</h3>
          <p>
            On whichever PC will observe, extract the ZIP and open{" "}
            <strong>Start-Observer.cmd</strong>.
          </p>
          <a
            className="button secondary"
            href="/downloads/Deadlock-AR-Observer.zip"
            download
          >
            Download observer companion ↓
          </a>
        </div>
        <div>
          <b>02</b>
          <h3>Pair the computer</h3>
          <p>
            Create a code and enter it in the companion with this website’s
            address.
          </p>
          <button
            className="button primary"
            disabled={busy}
            onClick={async () => {
              const p = await command("publisher/code", {
                label: `Observer ${publishers.length + 1}`,
              });
              if (p) setPair(p);
            }}
          >
            Create pairing code
          </button>
          {pair && (
            <div className="pairing-code">
              <code>{pair.code}</code>
              <small>Valid for five minutes · one use</small>
              <button
                className="button secondary"
                onClick={() =>
                  navigator.clipboard
                    .writeText(pair.code)
                    .then(() => setNotice("Pairing code copied."))
                    .catch(() => setNotice("Select the code and copy it."))
                }
              >
                Copy code
              </button>
            </div>
          )}
        </div>
        <div>
          <b>03</b>
          <h3>Record before the start</h3>
          <p>
            The companion gives you a fresh <strong>record</strong> command.
            Enter it in Deadlock’s console before the host starts. Enter{" "}
            <strong>stop</strong> after the game ends.
          </p>
          <p>
            Cheats must be enabled by the host. Spectator-slot compatibility
            remains an acceptance check.
          </p>
        </div>
      </div>
      <input
        aria-label="Studio address for companion"
        readOnly
        value={window.location.origin}
        onFocus={(e) => e.target.select()}
      />
      {publishers
        .filter((p) => !p.revoked)
        .map((p) => (
          <div className="observer-publisher" key={p.id}>
            <span>
              <strong>{p.label}</strong> ·{" "}
              {p.lastSeen && now - p.lastSeen < 10000 ? "connected" : "paired"}
              {p.lastSeen && (
                <small>
                  {" "}
                  · last update {new Date(p.lastSeen).toLocaleTimeString()}
                </small>
              )}
            </span>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() =>
                command("publisher/revoke", { id: p.id }).then(() =>
                  setPublishers((old) =>
                    old.map((x) =>
                      x.id === p.id ? { ...x, revoked: true } : x,
                    ),
                  ),
                )
              }
            >
              Disconnect computer
            </button>
          </div>
        ))}
      {notice && <p role="status">{notice}</p>}
      <details>
        <summary>How recording, video and results fit together</summary>
        <p>
          The companion sends statistics; gameplay video stays in your OBS
          workflow. Measure the game clock shown by OBS against the clock in
          this desk. Delay gameplay video and game audio together before adding
          the graphics. Send that combined view to the remote casters; add their
          returning microphones in the final production mix.
        </p>
        <p>
          The “Additional graphics delay” setting only delays graphics. It
          cannot make late data arrive earlier. Start with zero, measure your
          setup, and add a small video buffer appropriate to its actual delay.
        </p>
        <p>
          Final results are saved on a game-over signal. A disconnected PC or a
          stopped recording leaves the game incomplete. Review the saved result
          before publishing the scoreboard.
        </p>
        <p>
          Console entries in the recording are a partial audit, not a complete
          record of commands used by every player.
        </p>
      </details>
    </section>
  );
}

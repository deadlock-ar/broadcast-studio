import { useEffect, useState } from "react";
import {
  collectorEndpoint,
  collectorRequest,
  enqueueCollectorState,
} from "./collector";

export function useCollectorHealth(enabled = true) {
  const [health, setHealth] = useState(null),
    [error, setError] = useState("");
  useEffect(() => {
    if (!enabled) return;
    const abort = new AbortController();
    const poll = () =>
      collectorRequest(
        "health",
        null,
        undefined,
        AbortSignal.any([abort.signal, AbortSignal.timeout(4000)]),
      )
        .then((value) => {
          if (!abort.signal.aborted) {
            setHealth(value);
            setError("");
          }
        })
        .catch(() => {
          if (!abort.signal.aborted) {
            setHealth(null);
            setError(
              globalThis.__DLAR_CLOUD__
                ? "Cloud collector unavailable. Reopen the studio to reconnect."
                : "Start the collector on this PC to connect.",
            );
          }
        });
    const start = setTimeout(poll, 0),
      timer = setInterval(poll, 5000);
    return () => {
      abort.abort();
      clearTimeout(start);
      clearInterval(timer);
    };
  }, [enabled]);
  return { health, error };
}
export function useCollector(id, enabled = true, delayed = false) {
  const [session, setSession] = useState(null),
    [error, setError] = useState("");
  useEffect(() => {
    if (!enabled || !id) return;
    let queue = [],
      currentDelay = null;
    const source = new EventSource(collectorEndpoint("events", id));
    source.onmessage = (event) => {
      try {
        const value = JSON.parse(event.data);
        if (value.version !== 1 || value.id !== id) return;
        const delay = delayed ? (value.settings?.delayMs ?? 0) : 0;
        if (currentDelay !== delay) {
          queue = [];
          currentDelay = delay;
        }
        queue = enqueueCollectorState(queue, value, Date.now(), delay);
        setError("");
      } catch {
        setError("The collector sent an invalid update.");
      }
    };
    source.onerror = () =>
      setError(
        "Collector connection lost · reconnecting. Last values retained.",
      );
    const timer = setInterval(() => {
      let next;
      while (queue[0]?.at <= Date.now()) next = queue.shift().value;
      if (next) setSession(next);
    }, 40);
    return () => {
      source.close();
      clearInterval(timer);
      queue = [];
    };
  }, [id, enabled, delayed]);
  return { session: session?.id === id ? session : null, error };
}

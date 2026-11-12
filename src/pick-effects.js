export const PICK_EFFECT_DURATION_MS = 6000;
export const PICK_EFFECT_FADE_MS = 900;
export const BAN_EFFECT_DURATION_MS = 1800;

// A replacement starts its own six-second window; an old timeout cannot clear it.
export function createPickFlashController({
  onChange,
  schedule = setTimeout,
  cancel = clearTimeout,
} = {}) {
  let flashes = {};
  const timers = new Map();
  function reset(notify = true) {
    timers.forEach(({ timer }) => cancel(timer));
    timers.clear();
    const changed = Object.keys(flashes).length > 0;
    flashes = {};
    if (notify && changed) onChange({});
  }
  return {
    show(id, heroId, durationMs = PICK_EFFECT_DURATION_MS) {
      cancel(timers.get(id)?.timer);
      const token = {};
      flashes = { ...flashes, [id]: heroId };
      onChange(flashes);
      const timer = schedule(() => {
        if (timers.get(id)?.token !== token) return;
        timers.delete(id);
        const next = { ...flashes };
        delete next[id];
        flashes = next;
        onChange(flashes);
      }, durationMs);
      timers.set(id, { timer, token });
    },
    reset,
    dispose() {
      reset(false);
    },
  };
}

// The first state after joining/rejoining is a baseline, never a new pick.
export function createSelectionTracker(types = ["pick", "ban"]) {
  let previous = null;
  return {
    observe(snapshot, { initial = false } = {}) {
      const next = new Map(
        (snapshot?.steps || []).map((s) => [s.id, s.heroId]),
      );
      const picks =
        previous && !initial
          ? (snapshot?.steps || []).filter(
              (s) =>
                types.includes(s.selectionType) &&
                s.heroId &&
                previous.get(s.id) !== s.heroId,
            )
          : [];
      previous = next;
      return picks;
    },
    reset() {
      previous = null;
    },
  };
}

export const createPickTracker = () => createSelectionTracker(["pick"]);

export function selectionVoiceLines(hero, type, config) {
  if (type === "ban")
    return config.banVoiceLines
      ? (hero?.banVoiceLines || []).map((voice) => voice.url)
      : [];
  return config.voiceLines ? hero?.voiceLines || [] : [];
}

const SILENCE =
  "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQQAAACAgICA";

// One reusable audio element prevents simultaneous hero lines from overlapping.
export function createVoicePlayer({
  createAudio = () => new Audio(),
  schedule = setTimeout,
  cancel = clearTimeout,
  onBlocked = () => {},
} = {}) {
  const audio = createAudio();
  audio.preload = "auto";
  let enabled = false,
    volume = 0.7,
    queue = [],
    busy = false,
    timer,
    generation = 0,
    disposed = false;
  function clear() {
    generation++;
    cancel(timer);
    audio.pause();
    audio.onended = audio.onerror = null;
    queue = [];
    busy = false;
  }
  function next() {
    if (busy || !enabled || disposed || !queue.length) return;
    busy = true;
    const token = ++generation;
    audio.src = queue.shift();
    audio.volume = volume;
    const done = () => {
      if (token !== generation || disposed) return;
      cancel(timer);
      audio.pause();
      busy = false;
      next();
    };
    audio.onended = audio.onerror = done;
    timer = schedule(done, 10000);
    Promise.resolve(audio.play()).catch((error) => {
      if (token !== generation || disposed) return;
      if (error?.name === "NotAllowedError") {
        clear();
        onBlocked(true);
      } else done();
    });
  }
  return {
    configure(settings) {
      enabled = settings.enabled;
      volume = Math.max(0, Math.min(1, settings.volume));
      audio.volume = volume;
      if (!enabled) clear();
    },
    enqueue(url) {
      if (!enabled || disposed || !url) return;
      if (queue.length < 12) queue.push(url);
      next();
    },
    async unlock() {
      clear();
      const token = generation;
      audio.src = SILENCE;
      try {
        await audio.play();
        if (token !== generation || disposed) return false;
        audio.pause();
        onBlocked(false);
        return true;
      } catch {
        if (!disposed) onBlocked(true);
        return false;
      }
    },
    clear,
    dispose() {
      clear();
      disposed = true;
      audio.removeAttribute("src");
    },
  };
}

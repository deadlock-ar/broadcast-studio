import { cleanConfig, cleanSnapshot, makeDemo } from "./draft.js";
import { cleanPanel } from "./stats.js";
import { sessionId } from "../collector/model.mjs";
import { cleanReportSettings } from "./analytics.js";

export const OUTPUTS = {
  draft: "/obs/draft",
  "live-events": "/obs/live-events",
  deadem: "/obs/deadem",
  scoreboard: "/obs/scoreboard",
  ultimates: "/obs/ultimates",
};
export function blankDraft() {
  const draft = makeDemo();
  return {
    ...draft,
    draftCode: "",
    status: "WAITING",
    currentStepIndex: 0,
    steps: draft.steps.map((s) => ({ ...s, heroId: null })),
  };
}
export function initialWorkspace() {
  return {
    version: 1,
    revision: 0,
    config: cleanConfig(),
    draft: {
      code: "",
      mode: "manual",
      snapshot: blankDraft(),
      status: { state: "idle", message: "Connect a draft or use manual mode." },
    },
    apiStats: {
      source: null,
      panel: cleanPanel(),
      time: null,
      visible: true,
      result: {
        match: null,
        status: "idle",
        message: "Choose a match.",
        updated: null,
      },
    },
    deadem: {
      id: "",
      panel: cleanPanel({ theme: "ink" }),
      visible: true,
      hudVisible: true,
    },
    scoreboard: { matchId: "", visible: true },
    reports: cleanReportSettings(),
  };
}
export const equalValue = (a, b) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
export function getAt(value, path) {
  return path.reduce((v, key) => v?.[key], value);
}
export function diffFields(before, value, path = []) {
  if (equalValue(before, value)) return [];
  if (
    before &&
    value &&
    typeof before === "object" &&
    typeof value === "object" &&
    Array.isArray(before) === Array.isArray(value) &&
    (!Array.isArray(value) || before.length === value.length)
  ) {
    return [
      ...new Set([...Object.keys(before), ...Object.keys(value)]),
    ].flatMap((k) =>
      diffFields(before[k], value[k], [
        ...path,
        Array.isArray(value) ? Number(k) : k,
      ]),
    );
  }
  return [
    {
      path,
      before: before ?? null,
      value: value ?? null,
      remove: value === undefined,
    },
  ];
}
export function applyOperations(state, operations, checkBefore = true) {
  if (!Array.isArray(operations) || operations.length > 150)
    throw Error("Invalid workspace update.");
  const next = structuredClone(state);
  for (const op of operations) {
    if (
      !Array.isArray(op.path) ||
      !op.path.length ||
      op.path.length > 8 ||
      op.path.some(
        (k) =>
          !(typeof k === "string" || Number.isInteger(k)) ||
          ["__proto__", "constructor", "prototype"].includes(String(k)),
      )
    )
      throw Error("Invalid setting path.");
    if (checkBefore && !equalValue(getAt(state, op.path), op.before)) {
      const error = Error(
        "Another admin changed this setting. Your screen has refreshed; please try the edit again.",
      );
      error.status = 409;
      throw error;
    }
    let target = next;
    for (const key of op.path.slice(0, -1)) {
      if (!target[key] || typeof target[key] !== "object") target[key] = {};
      target = target[key];
    }
    const key = op.path.at(-1);
    if (op.remove) delete target[key];
    else target[key] = structuredClone(op.value);
  }
  return next;
}
export function patchWorkspace(state, operations) {
  for (const op of operations || []) {
    const [section, key] = op.path || [];
    const valid =
      section === "config" ||
      section === "reports" ||
      (section === "draft" &&
        key === "snapshot" &&
        state.draft.mode !== "live") ||
      (section === "apiStats" && ["panel", "time", "visible"].includes(key)) ||
      (section === "deadem" &&
        ["panel", "id", "visible", "hudVisible"].includes(key)) ||
      (section === "scoreboard" && key === "visible");
    if (!valid)
      throw Error("This field is controlled by the broadcast service.");
  }
  const next = applyOperations(state, operations);
  next.config = cleanConfig(next.config);
  next.reports = cleanReportSettings(next.reports);
  next.draft.snapshot = cleanSnapshot(next.draft.snapshot);
  for (const key of ["apiStats", "deadem"]) {
    next[key].panel = cleanPanel(next[key].panel);
    next[key].visible = next[key].visible === true;
  }
  next.deadem.id = next.deadem.id ? sessionId(next.deadem.id) : "";
  next.deadem.hudVisible = next.deadem.hudVisible === true;
  next.scoreboard.visible = next.scoreboard.visible === true;
  next.apiStats.time =
    next.apiStats.time === null
      ? null
      : Math.max(0, Math.min(86400, Number(next.apiStats.time) || 0));
  next.revision = state.revision + 1;
  return next;
}

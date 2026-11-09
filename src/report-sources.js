// A finished game's hero roster is not evidence of a draft's selections.
// Older genuine draft archives may predate the explicit source field.
export function isDraftReportSource(record) {
  return Boolean(
    record &&
      (record.source === undefined ||
        ["live", "manual"].includes(record.source)) &&
      record.rule !== "metadata-final-roster" &&
      !String(record.id || "").startsWith("metadata:") &&
      (Array.isArray(record.selections) ||
        Array.isArray(record.snapshot?.steps)),
  );
}

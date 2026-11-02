export const CONSOLE_ENTRY_LIMIT = 500;
export const CONSOLE_COMMAND_LIMIT = 500;

// CDemoConsoleCmd carries command text, not the identity of its author.
// These records are partial evidence from one demo, never an all-player audit.
export function appendConsoleEntry(entries, packet) {
  if (packet?.type?.id !== 9) return false;
  const data = packet.data;
  const command = [data?.cmdstring, data?.command, data?.cmd].find(
    (value) => typeof value === "string" && value.trim(),
  );
  if (!command) return false;
  entries.push({
    tick: Number.isFinite(packet.tick) ? packet.tick : null,
    command: command.slice(0, CONSOLE_COMMAND_LIMIT),
    truncated: command.length > CONSOLE_COMMAND_LIMIT,
    playerId: null,
    source: "demo-console-command",
  });
  if (entries.length > CONSOLE_ENTRY_LIMIT)
    entries.splice(0, entries.length - CONSOLE_ENTRY_LIMIT);
  return true;
}

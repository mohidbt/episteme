export interface ParsedSlashCommand {
  cmd: string;
  args: string;
}

/**
 * Parse a raw slash command string like "/cite doe2024" into { cmd, args }.
 * Returns null if the string doesn't start with "/".
 */
export function parseSlashCommand(input: string): ParsedSlashCommand | null {
  if (!input.startsWith("/")) return null;
  const rest = input.slice(1);
  const spaceIdx = rest.search(/\s/);
  if (spaceIdx === -1) {
    return { cmd: rest, args: "" };
  }
  const cmd = rest.slice(0, spaceIdx);
  const args = rest.slice(spaceIdx).trimStart();
  return { cmd, args };
}

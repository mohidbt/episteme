// Derive a friendly library label from the user's name.
// Falls back to "My Library" when the name is missing or blank.
export function deriveLibraryName(user: { name?: string | null }): string {
  const raw = typeof user.name === "string" ? user.name.trim() : "";
  if (!raw) return "My Library";
  const first = raw.split(/\s+/)[0];
  if (!first) return "My Library";
  return `${first}'s Library`;
}

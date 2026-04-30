/**
 * Task #41 — derive a short, readable thread title from the user's first
 * message. Used when a thread is auto-created on first invoke and has no
 * user-supplied title yet.
 *
 *   - Collapses internal whitespace runs to a single space
 *   - Trims leading/trailing whitespace
 *   - Truncates to `maxLen` chars (default 50), preferring a word boundary
 *     and appending `…` when the source was longer.
 *   - Returns `null` for empty/whitespace-only input so callers can fall back
 *     to the generic "Conversation #abcd1234" label.
 */
export function deriveThreadTitle(message: string, maxLen = 50): string | null {
  const collapsed = message.replace(/\s+/g, " ").trim();
  if (!collapsed) return null;
  if (collapsed.length <= maxLen) return collapsed;

  // Prefer cutting at the last space inside the budget so we don't slice a
  // word in half. If no space exists in the budget, hard-cut.
  const budget = collapsed.slice(0, maxLen);
  const lastSpace = budget.lastIndexOf(" ");
  const cut = lastSpace > 20 ? budget.slice(0, lastSpace) : budget;
  return `${cut.trimEnd()}…`;
}

// Matches [n] where n is 1–999
const MARKER_RE = /\[(\d{1,3})\]/g;

/**
 * Given a text string and a character offset within it, returns the
 * markerIndex (number) if the offset falls inside a `[n]` citation marker,
 * or null otherwise.
 *
 * Markers outside the range 1–999 are ignored (return null).
 */
export function findCitationMarkerAtOffset(
  text: string,
  offset: number
): number | null {
  if (!text || offset < 0 || offset >= text.length) return null;

  MARKER_RE.lastIndex = 0;
  for (const match of text.matchAll(MARKER_RE)) {
    const start = match.index!;
    const end = start + match[0].length - 1; // inclusive end (the ']')
    if (offset >= start && offset <= end) {
      const n = parseInt(match[1], 10);
      if (n >= 1 && n <= 999) return n;
    }
  }

  return null;
}

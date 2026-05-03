/**
 * When a user clicks inside the PDF, pdfjs often renders `<a>` internal-link
 * annotations over `[n]` citation markers (so clicking jumps to references).
 * These annotation links sit above the text layer and steal the click before
 * caretRangeFromPoint can land on a text node. This helper recovers by walking
 * up to the nearest <a> and matching its bare digit text against citations.
 */
export function findCitationFromAnchor<T extends { markerIndex: number }>(
  target: Element | null,
  citations: T[]
): T | null {
  if (!target) return null;
  const anchor = target.closest("a");
  if (!anchor) return null;
  // pdfjs internal-link annotations often have empty text and encode the
  // marker in the `title` attribute (e.g., title="13"). Fall back to title
  // when text is empty.
  const source =
    (anchor.textContent ?? "").trim() ||
    (anchor.getAttribute("title") ?? "").trim();
  const match = source.match(/^\[?(\d{1,3})\]?$/);
  if (!match) return null;
  const idx = Number(match[1]);
  if (idx < 1 || idx > 999) return null;
  return citations.find((c) => c.markerIndex === idx) ?? null;
}

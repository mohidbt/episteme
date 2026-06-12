// GSD-100 - pdf-anchor token helpers.
//
// The deep-read agent skill emits page-granular citation anchors as
// `[[pdf:<paper-uuid>#p<N>]]`. The agent prose is rendered through
// Streamdown (react-markdown) which does NOT understand this grammar,
// so the token leaks as literal text. Mirror the LibTokenizedText
// precedent: pre-transform the markdown so a single Streamdown pass
// can both keep markdown structure (paragraphs, lists, code blocks)
// and emit a pill-shaped React node per anchor via a custom `a`
// component renderer.
//
// Grammar: id is alphanumeric + hyphens (no dot), page is one-or-more
// digits. The dot exclusion keeps the legacy `[[pdf:foo.pdf]]` form
// (used by packages/notes-core/rebuild-links) out of this matcher.

export const PDF_TOKEN_RE =
  /\[\[pdf:(?<id>[A-Za-z0-9-]+)#p(?<page>\d+)\]\]/g;

const SENTINEL_PREFIX = "#__pdf:";

/**
 * Rewrite every `[[pdf:UUID#pN]]` token in `text` to a markdown link
 * with a sentinel href: `[p N](#__pdf:UUID:N)`. The sentinel href is
 * intercepted by the custom `a` component in the Streamdown components
 * map and rendered as an inline pill.
 *
 * Non-matching text - including the legacy `[[pdf:foo.pdf]]` form -
 * passes through unchanged.
 */
export function replacePdfTokensWithLinks(text: string): string {
  // Allocate a fresh regex per call so the global `lastIndex` state
  // never leaks between calls (the shared `PDF_TOKEN_RE` is exposed
  // for tests but should not be relied on across iterations).
  const re = new RegExp(PDF_TOKEN_RE.source, "g");
  return text.replace(re, (_match, id: string, page: string) => {
    return `[p ${page}](${SENTINEL_PREFIX}${id}:${page})`;
  });
}

export interface PdfSentinel {
  paperId: string;
  page: number;
}

/**
 * Inverse of the sentinel encoding. Returns null for any href that did
 * not come from `replacePdfTokensWithLinks`.
 */
export function parsePdfSentinelHref(
  href: string | undefined,
): PdfSentinel | null {
  if (!href || !href.startsWith(SENTINEL_PREFIX)) return null;
  const rest = href.slice(SENTINEL_PREFIX.length);
  const idx = rest.lastIndexOf(":");
  if (idx <= 0 || idx === rest.length - 1) return null;
  const paperId = rest.slice(0, idx);
  const pageStr = rest.slice(idx + 1);
  const page = Number.parseInt(pageStr, 10);
  if (!Number.isFinite(page) || page <= 0) return null;
  return { paperId, page };
}

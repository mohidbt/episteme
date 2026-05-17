/**
 * Strip JATS XML tags and decode common HTML entities from reference abstracts.
 *
 * Render-side fallback used as defense-in-depth alongside the ingest-time strip
 * in `apps/km/src/lib/crossref.ts`. Kept deliberately minimal — no full HTML
 * parser, just the common cases.
 */

const ENTITY_MAP: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function decodeEntities(input: string): string {
  return input.replace(/&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const code = parseInt(body.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    if (body.startsWith("#")) {
      const code = parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    const v = ENTITY_MAP[body.toLowerCase()];
    return v ?? m;
  });
}

export function stripJats(input: string): string {
  return input
    .replace(/<\/?jats:[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Combined strip + entity decode. Safe to call on any string. */
export function sanitizeAbstract(input: string | null | undefined): string {
  if (!input) return "";
  return decodeEntities(stripJats(input));
}

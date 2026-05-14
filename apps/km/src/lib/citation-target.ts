/**
 * B7 — resolve where a chat-transcript citation click should land.
 *
 * When the agent transcript is embedded inside the reader (URL path
 * `/papers/[id]/read`), clicking a citation must scroll the existing reader
 * in-place — navigating to a different route would unmount the reader and
 * blow away the conversation. Outside the reader (drive view, public
 * `/p/[id]`, etc.) we route to the reader URL so the click lands the user on
 * the cited page.
 *
 * Do NOT fall through to `/p/[id]` for in-reader clicks. The public viewer is
 * a different surface that doesn't host the chat panel.
 */

export type CitationTarget =
  | { kind: "in-place"; paperId: string; page: number; bbox: string | null }
  | { kind: "navigate"; url: string };

/**
 * Match a Next.js App Router pathname for `/papers/[id]/read`. The id is a
 * UUID-like opaque string but we don't try to validate it here — any non-empty
 * segment counts because the path shape is what matters for the routing
 * decision.
 */
const READER_PATH_RE = /^\/papers\/[^/]+\/read(?:$|[/?#])/;

export function isReaderPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return READER_PATH_RE.test(pathname);
}

export function resolveCitationTarget(args: {
  pathname: string | null | undefined;
  paperId: string;
  page: number;
  bbox: string | null;
}): CitationTarget {
  const { pathname, paperId, page, bbox } = args;
  const safePage = page > 0 ? page : 1;
  if (isReaderPath(pathname)) {
    return { kind: "in-place", paperId, page: safePage, bbox };
  }
  const hl = bbox ? `&hl=${encodeURIComponent(bbox)}` : "";
  return {
    kind: "navigate",
    url: `/papers/${paperId}/read?p=${safePage}${hl}`,
  };
}

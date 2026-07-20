// Matches a URL with an explicit scheme, e.g. `https:`, `mailto:`, `tel:`,
// `ftp:`. Per RFC 3986 a scheme is a letter followed by letters/digits/+/-/.,
// terminated by a colon.
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

// A bare `host:port` authority with no scheme, e.g. `example.com:8080` or
// `localhost:3000`. The host must look like a hostname (a dotted name or the
// literal `localhost`) so we don't misclassify scheme URLs whose body is
// numeric (`tel:112`). Checked before HAS_SCHEME so the port colon isn't
// mistaken for a scheme separator.
const HOST_PORT = /^(?:localhost|[a-z0-9-]+(?:\.[a-z0-9-]+)+):\d+(?:[/?#]|$)/i;

// A bare hostname as the first path segment, e.g. `google.com` or
// `sub.example.co.uk/path?q=1`. The first segment (up to the next `/`, `?`, or
// `#`) must contain a dot with a TLD-like label (2+ letters) after it, so we
// only auto-prepend `https://` when the input really looks like an external
// host. Schemeless relative paths (`foo/bar`, `foo`) have no such dotted-TLD
// first segment and are left untouched.
const HOST_NAME = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:[/?#:]|$)/i;

// Schemes that can execute script or smuggle payloads. The manual link-insert
// path (AiBubbleMenu/LinkBubbleMenu) writes the href straight into a link mark
// via insertContent, bypassing Tiptap's setLink protocol allowlist, so we guard
// here at the shared normalization chokepoint.
const DANGEROUS_SCHEME = /^(?:javascript|data|vbscript|file):/i;

/**
 * Normalize a user-typed link href so a bare hostname resolves as an absolute
 * external URL instead of a path relative to the current editor route.
 *
 * Typing `google.com` in the link window otherwise yields an `<a href="google.com">`,
 * which the browser resolves against the current document (`/n/<slug>`), producing
 * a garbage relative link (`.../n/google.com`). We prepend `https://` for bare
 * hosts while leaving anything already absolute or intentionally internal untouched.
 *
 * Left unchanged:
 * - URLs with a scheme (`https://`, `http://`, `mailto:`, `tel:`, …)
 * - protocol-relative URLs (`//cdn.example.com/x`)
 * - internal/relative links (`/n/foo`, `#anchor`, `?q=1`)
 */
export function normalizeLinkHref(input: string): string {
  // Runtime guard: callers occasionally hand us null/undefined/non-string
  // values (unset href attrs, malformed pasted marks). Fail closed to an inert
  // href rather than throwing on `.trim()`.
  if (typeof input !== "string") return "#";
  const trimmed = input.trim();
  if (!trimmed) return "";
  // Neutralize script-bearing schemes to an inert relative href rather than
  // persisting an executable link.
  if (DANGEROUS_SCHEME.test(trimmed)) return "#";
  if (HOST_PORT.test(trimmed)) return `https://${trimmed}`;
  if (HAS_SCHEME.test(trimmed)) return trimmed;
  if (trimmed.startsWith("//")) return trimmed;
  if (/^[/#?]/.test(trimmed)) return trimmed;
  // Only auto-prepend `https://` when the first path segment looks like an
  // external host (dotted name with a TLD). Otherwise treat it as an
  // intentional relative path (`./foo`, `../foo`, `foo/bar`) and leave it be.
  if (HOST_NAME.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

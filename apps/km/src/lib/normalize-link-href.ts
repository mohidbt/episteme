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
  const trimmed = input.trim();
  if (!trimmed) return "";
  // Neutralize script-bearing schemes to an inert relative href rather than
  // persisting an executable link.
  if (DANGEROUS_SCHEME.test(trimmed)) return "#";
  if (HOST_PORT.test(trimmed)) return `https://${trimmed}`;
  if (HAS_SCHEME.test(trimmed)) return trimmed;
  if (trimmed.startsWith("//")) return trimmed;
  if (/^[/#?]/.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

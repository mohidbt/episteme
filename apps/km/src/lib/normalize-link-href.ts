// Matches a URL with an explicit scheme, e.g. `https:`, `mailto:`, `tel:`,
// `ftp:`. Per RFC 3986 a scheme is a letter followed by letters/digits/+/-/.,
// terminated by a colon.
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

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
  if (HAS_SCHEME.test(trimmed)) return trimmed;
  if (trimmed.startsWith("//")) return trimmed;
  if (/^[/#?]/.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

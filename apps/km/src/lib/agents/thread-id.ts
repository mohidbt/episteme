// GSD-219: thread_id is client-supplied and gets interpolated UNESCAPED into a
// signed URL path (see state/[thread]/route.ts). A thread_id containing `#`,
// `?`, `/`, or whitespace makes `fetch` strip/re-parse the path (fragment,
// query, extra segment) so the URL the agents service receives no longer
// matches the HMAC-signed path string → a confusing 401 instead of a clear
// rejection. Restrict to a URL-segment-safe alphabet at every ingress.
//
// Real thread_ids are `crypto.randomUUID()` (lib/threads.ts) → hex + hyphen,
// a strict subset of this alphabet, so no legitimate thread is rejected.
export const THREAD_ID_RE = /^[A-Za-z0-9_-]+$/;
export const MAX_THREAD_ID_CHARS = 255;

export function isValidThreadId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_THREAD_ID_CHARS &&
    THREAD_ID_RE.test(value)
  );
}

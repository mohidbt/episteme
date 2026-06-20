// #69 — Stable error codes for OpenRouter auth failures.
// API routes return one of these codes; the UI renders a friendly message
// with a link to /settings/agents (see openrouter-error-message.tsx).

export const OPENROUTER_KEY_MISSING = "OPENROUTER_KEY_MISSING";
export const OPENROUTER_KEY_INVALID = "OPENROUTER_KEY_INVALID";

export type OpenRouterKeyErrorCode =
  | typeof OPENROUTER_KEY_MISSING
  | typeof OPENROUTER_KEY_INVALID;

/** Map an upstream OpenRouter HTTP status to a stable key-error code, or null. */
export function mapOpenRouterStatus(status: number): OpenRouterKeyErrorCode | null {
  if (status === 401 || status === 403) return OPENROUTER_KEY_INVALID;
  return null;
}

export function isOpenRouterKeyError(code: unknown): code is OpenRouterKeyErrorCode {
  return code === OPENROUTER_KEY_MISSING || code === OPENROUTER_KEY_INVALID;
}

// GSD-136 — OR returns HTTP 401 (NOT 402) when a Provisioning-API-created
// key has its `limit` exhausted. The body contains a quota/credit hint
// distinguishable from a real auth failure. classifyOrError consumes both
// status + body so AI route handlers can correctly emit `trial_exhausted`
// instead of falling through to `OPENROUTER_KEY_INVALID`.
//
// Hint list shared with apps/km/src/lib/key-health.ts and the Python
// sidecar's classify_provider_error. "credit limit" is new (matches OR's
// "This request requires more credits" / "exceeds your credit limit"
// wording observed on 401 limit-exceeded responses).
export const OR_QUOTA_HINTS = [
  "insufficient_quota",
  "insufficient credit",
  "insufficient credits",
  "payment_required",
  "out of credit",
  "balance",
  "quota exceeded",
  "credit limit",
  "more credits",
  "fewer max_tokens",
] as const;

export type OrErrorClassification = "trial_exhausted" | "key_invalid" | "other";

function bodyHasQuotaHint(bodyText: string): boolean {
  const lower = (bodyText ?? "").toLowerCase();
  return OR_QUOTA_HINTS.some((h) => lower.includes(h));
}

/**
 * Classify an upstream OpenRouter response for an AI completion / embedding
 * call. Distinguishes the trial-exhausted (limit drained) case from real
 * auth failures so the route handler can return the correct stable code.
 *
 * - 402 (legacy contract) → trial_exhausted
 * - 401 + body quota hint → trial_exhausted (the GSD-136 fix)
 * - 401 without hint     → key_invalid
 * - 403 + quota hint     → trial_exhausted (legacy 403-quota path)
 * - 403 without hint     → key_invalid
 * - anything else        → other (caller bubbles to generic upstream_error)
 */
export function classifyOrError(
  status: number,
  bodyText: string,
): OrErrorClassification {
  if (status === 402) return "trial_exhausted";
  if (status === 401 || status === 403) {
    return bodyHasQuotaHint(bodyText) ? "trial_exhausted" : "key_invalid";
  }
  return "other";
}

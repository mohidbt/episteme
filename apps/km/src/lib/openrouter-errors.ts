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

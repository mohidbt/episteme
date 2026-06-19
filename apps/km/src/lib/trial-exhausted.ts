// GSD-126 P1a — client-side trial-exhausted handling.
//
// The AI routes (ai-fill, agents/km/invoke, papers/[id]/outline, and any
// route piped through streamPassthrough) return HTTP 402 with body
// { error: "trial_exhausted" } when the signed-in user's managed
// OpenRouter $5 bucket is drained. This module gives every client
// callsite a one-liner upgrade:
//
//   const res = await fetchOrThrowTrialExhausted(url, init);
//
// On 402 the helper throws TrialExhaustedError. The catch site calls
// surfaceTrialExhaustedToast() which fires a single sonner toast per
// 5-minute browser-tab window (so a chat with N failed tool calls only
// shows ONE toast).
import { toast } from "sonner";

export class TrialExhaustedError extends Error {
  constructor() {
    super("trial_exhausted");
    this.name = "TrialExhaustedError";
  }
}

export const TRIAL_EXHAUSTED_TOAST_COPY =
  "You've used your $5 AI trial. Email founders@episteme.app to extend — full subscriptions coming soon.";

export const TRIAL_EXHAUSTED_DEDUP_KEY = "episteme:trial-exhausted-last-shown";
export const TRIAL_EXHAUSTED_DEDUP_MS = 5 * 60 * 1000;

/**
 * Drop-in replacement for `fetch` that converts the 402 trial_exhausted
 * contract into a typed exception. Non-402 responses, and 402s with any
 * other body shape, pass through untouched so callers can keep their
 * existing error handling for those branches.
 *
 * The 4th argument (`fetchImpl`) is for unit tests only — production
 * callsites pass two args.
 */
export async function fetchOrThrowTrialExhausted(
  input: RequestInfo | URL,
  init?: RequestInit,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<Response> {
  const res = await fetchImpl(input, init);
  if (res.status === 402) {
    // Clone before reading: the original Response body must remain
    // consumable for the (rare) caller that wants to inspect the
    // non-trial-exhausted 402 payload.
    const body = await res
      .clone()
      .json()
      .catch(() => null);
    if (
      body &&
      typeof body === "object" &&
      "error" in body &&
      (body as { error?: unknown }).error === "trial_exhausted"
    ) {
      throw new TrialExhaustedError();
    }
  }
  return res;
}

/**
 * Surface a single trial-exhausted toast across the whole app, even if
 * dozens of tool calls in the same chat 402 in rapid succession.
 *
 * Dedup is best-effort: failures to read/write sessionStorage (SSR,
 * Safari private mode, sandboxed iframes) fall through to "just toast
 * anyway", which is the right default — better one extra toast than a
 * silent failure.
 */
export function surfaceTrialExhaustedToast(): void {
  const now = Date.now();
  let lastShown = 0;
  try {
    const raw = sessionStorage.getItem(TRIAL_EXHAUSTED_DEDUP_KEY);
    if (raw != null) {
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) lastShown = parsed;
    }
  } catch {
    // sessionStorage threw (SSR / private mode) — proceed without dedup.
  }
  if (now - lastShown < TRIAL_EXHAUSTED_DEDUP_MS) return;
  try {
    sessionStorage.setItem(TRIAL_EXHAUSTED_DEDUP_KEY, String(now));
  } catch {
    // Same as above — degrade silently.
  }
  toast.error(TRIAL_EXHAUSTED_TOAST_COPY);
}

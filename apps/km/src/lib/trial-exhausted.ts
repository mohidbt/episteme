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
  "You've used your $5 AI trial. Subscribe to keep AI on.";
// GSD-141: signed-in exhaustion now routes to the live subscribe flow.
export const TRIAL_EXHAUSTED_CTA_LABEL = "Subscribe";
export const TRIAL_EXHAUSTED_CTA_HREF = "/settings/billing";

// GSD-130: guests get a different copy + a Sign-up CTA pointing at the
// signup wizard. Keep the dedup window shared with the signed-in path so
// a guest who burns through the $1 bucket via N rapid tool calls only
// sees one toast.
export const TRIAL_EXHAUSTED_GUEST_TOAST_COPY =
  "You've used your free $1 of AI. Sign up to keep going.";
export const TRIAL_EXHAUSTED_GUEST_CTA_LABEL = "Sign up";
export const TRIAL_EXHAUSTED_GUEST_CTA_HREF = "/sign-up";

export const TRIAL_EXHAUSTED_DEDUP_KEY = "episteme:trial-exhausted-last-shown";
export const TRIAL_EXHAUSTED_DEDUP_MS = 5 * 60 * 1000;

export type TrialExhaustedVariant = "user" | "guest";

/**
 * Look up the guest-vs-signed-in flag the (app) layout pinned on the
 * `<main data-anon="...">` element. Lets the toast helper pick the right
 * copy without prop-drilling session through every AI call site.
 * Falls back to "user" when:
 *   - we're outside the browser (SSR, vitest node env), OR
 *   - the data attribute is missing (e.g. /sign-in, /sign-up, settings
 *     layout — none of which fire the toast anyway).
 */
function detectVariantFromDom(): TrialExhaustedVariant {
  if (typeof document === "undefined") return "user";
  const el = document.querySelector("[data-anon]") as HTMLElement | null;
  return el?.dataset.anon === "true" ? "guest" : "user";
}

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
export function surfaceTrialExhaustedToast(
  variant?: TrialExhaustedVariant,
): void {
  const resolved: TrialExhaustedVariant = variant ?? detectVariantFromDom();
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
  if (resolved === "guest") {
    toast.error(TRIAL_EXHAUSTED_GUEST_TOAST_COPY, {
      action: {
        label: TRIAL_EXHAUSTED_GUEST_CTA_LABEL,
        onClick: () => {
          // Full nav (not router.push) — the toast lives outside the
          // Next.js router context, and a hard nav is the safest cross-
          // surface jump from any AI-using page (notes editor, reader,
          // settings, etc.).
          if (typeof window !== "undefined") {
            window.location.href = TRIAL_EXHAUSTED_GUEST_CTA_HREF;
          }
        },
      },
    });
    return;
  }
  toast.error(TRIAL_EXHAUSTED_TOAST_COPY, {
    action: {
      label: TRIAL_EXHAUSTED_CTA_LABEL,
      onClick: () => {
        // Full nav (see guest branch above) — toast lives outside the router.
        if (typeof window !== "undefined") {
          window.location.href = TRIAL_EXHAUSTED_CTA_HREF;
        }
      },
    },
  });
}

// ---------------------------------------------------------------------------
// GSD-139 — usage-threshold notifier (70% / 90% → subscribe-soon).
//
// A signed-in user crossing 70% then 90% of their OpenRouter managed-bucket
// soft limit gets a single non-blocking nudge BEFORE the hard 402 at 100%.
// Reuses the same data path as /settings/data — GET /api/openrouter/usage,
// which returns { totalUsd, limitUsd, isGuest } from the cached local spend
// sum (no new live OR call). Guests are out of scope (GSD-130 handles their
// $1 cap + sign-up CTA), and the endpoint's own isGuest flag is the gate.
// ---------------------------------------------------------------------------

export const USAGE_THRESHOLD_70_KEY = "episteme:usage-threshold-70-shown";
export const USAGE_THRESHOLD_90_KEY = "episteme:usage-threshold-90-shown";

export const USAGE_THRESHOLD_70_COPY =
  "Heads up — you've used 70% of your AI trial. Subscribe soon to keep things running.";
export const USAGE_THRESHOLD_90_COPY =
  "Almost out of AI credit — subscribe to keep AI on.";
export const USAGE_THRESHOLD_CTA_LABEL = "Subscribe";
// GSD-141: subscribe flow is live — point signed-in nudges at the billing page.
export const USAGE_THRESHOLD_CTA_HREF = "/settings/billing";

// Throttle the usage GET so token-by-token streams / rapid tool calls don't
// hammer /api/openrouter/usage. Once 90% has fired we skip the network entirely.
const USAGE_THRESHOLD_FETCH_THROTTLE_MS = 60 * 1000;
let lastUsageFetchAt = 0;

/** Test-only: reset the in-process fetch throttle between cases. */
export function __resetUsageThrottleForTest(): void {
  lastUsageFetchAt = 0;
}

function alreadyShown(key: string): boolean {
  try {
    return sessionStorage.getItem(key) != null;
  } catch {
    // sessionStorage unavailable (SSR / private mode) — treat as not-shown so
    // the warn still has a chance to fire; the throttle below caps spam per tab.
    return false;
  }
}

function markShown(key: string): void {
  try {
    sessionStorage.setItem(key, String(Date.now()));
  } catch {
    // Degrade silently — best-effort dedup only.
  }
}

function navigateToSubscribe(): void {
  if (typeof window !== "undefined") {
    window.location.href = USAGE_THRESHOLD_CTA_HREF;
  }
}

interface UsageSnapshot {
  totalUsd?: unknown;
  limitUsd?: unknown;
  isGuest?: unknown;
}

/**
 * Opportunistic post-AI-call check: fetch current managed-bucket spend and,
 * if a signed-in user just crossed 70% or 90% of their soft limit, fire a
 * single subscribe-soon toast. Never throws and never blocks the AI UX —
 * any failure (network, parse, divide-by-zero, sessionStorage) is swallowed.
 *
 * The `fetchImpl` arg is for unit tests only — production callsites pass none.
 */
export async function maybeNotifyUsageThreshold(
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<void> {
  // Cheap exits before any network: 90% already shown, or we fetched within
  // the throttle window.
  if (alreadyShown(USAGE_THRESHOLD_90_KEY)) return;
  const now = Date.now();
  if (now - lastUsageFetchAt < USAGE_THRESHOLD_FETCH_THROTTLE_MS) return;
  lastUsageFetchAt = now;

  let snapshot: UsageSnapshot | null = null;
  try {
    const res = await fetchImpl("/api/openrouter/usage");
    if (!res.ok) return;
    snapshot = (await res.json()) as UsageSnapshot;
  } catch {
    return;
  }
  if (!snapshot || snapshot.isGuest === true) return;

  const totalUsd = Number(snapshot.totalUsd);
  const limitUsd = Number(snapshot.limitUsd);
  if (!Number.isFinite(totalUsd) || !Number.isFinite(limitUsd) || limitUsd <= 0) {
    return;
  }
  const pct = totalUsd / limitUsd;

  if (pct >= 0.9) {
    if (alreadyShown(USAGE_THRESHOLD_90_KEY)) return;
    // Mark 70 too so a later sub-90 call can't retroactively fire the gentler
    // toast after we've already escalated.
    markShown(USAGE_THRESHOLD_70_KEY);
    markShown(USAGE_THRESHOLD_90_KEY);
    toast.warning(USAGE_THRESHOLD_90_COPY, {
      action: {
        label: USAGE_THRESHOLD_CTA_LABEL,
        onClick: navigateToSubscribe,
      },
    });
    return;
  }

  if (pct >= 0.7) {
    if (alreadyShown(USAGE_THRESHOLD_70_KEY)) return;
    markShown(USAGE_THRESHOLD_70_KEY);
    // Clear the fetch throttle so a rapid 70→90 crossing in the same minute
    // can still re-fetch and fire the 90% escalation on the next AI call
    // (the 90 key gates re-firing, so this can't double-toast).
    lastUsageFetchAt = 0;
    toast.warning(USAGE_THRESHOLD_70_COPY, {
      action: {
        label: USAGE_THRESHOLD_CTA_LABEL,
        onClick: navigateToSubscribe,
      },
    });
  }
}

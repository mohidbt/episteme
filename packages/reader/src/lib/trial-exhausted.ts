// GSD-126 P1a — mirror of apps/km/src/lib/trial-exhausted.ts.
//
// The reader package can't import from apps/km, but the trial-exhausted
// contract is the same: 402 JSON body { error: "trial_exhausted" } from
// any AI route, surfaced via a single 5-minute-deduped sonner toast.
//
// Keep the two copies symmetric — if you change the dedup window, the
// copy, or the storage key here, update apps/km too.
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

export async function fetchOrThrowTrialExhausted(
  input: RequestInfo | URL,
  init?: RequestInit,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<Response> {
  const res = await fetchImpl(input, init);
  if (res.status === 402) {
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
    // SSR or sandboxed iframe — degrade silently.
  }
  if (now - lastShown < TRIAL_EXHAUSTED_DEDUP_MS) return;
  try {
    sessionStorage.setItem(TRIAL_EXHAUSTED_DEDUP_KEY, String(now));
  } catch {
    // Same as above.
  }
  toast.error(TRIAL_EXHAUSTED_TOAST_COPY);
}

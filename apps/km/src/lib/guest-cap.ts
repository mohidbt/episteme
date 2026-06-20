// GSD-130 — server-enforced soft cap on anonymous (guest) AI usage.
//
// Signed-in users have their own per-user managed OpenRouter bucket with
// a hard $5 limit at the provider; trial-exhausted there surfaces as a
// 401/403 with a quota hint, classified upstream into `trial_exhausted`.
//
// Guests share `OPENROUTER_API_KEY` (no per-guest provisioning); the only
// thing standing between a guest and unbounded org-bucket burn was a
// UI-only $1 indicator. This module enforces that same $1 server-side:
// sum `openrouter_usage.cost_usd` over the same 7-day window the
// /settings/data guest panel reads, throw `GuestTrialExhausted` once the
// sum is >= $1. Route handlers map the throw to the existing
// `402 { error: "trial_exhausted" }` envelope so the same toast/CTA
// plumbing fires.
//
// Race tolerance: two concurrent guest calls at $0.95 both pass the
// SELECT and write. Worst-case overshoot is small; the env key is shared
// + no real money is exposed per-guest, so a hard transactional cap
// would be overkill. The point is to stop a scripted guest, not bill.

import {
  getRecentSpendUsd,
  OR_GUEST_SOFT_LIMIT_USD,
} from "./openrouter-usage";

export class GuestTrialExhausted extends Error {
  constructor() {
    super("GuestTrialExhausted");
    this.name = "GuestTrialExhausted";
  }
}

export interface GuestCapSession {
  userId: string;
  isAnonymous: boolean;
}

/**
 * No-op for signed-in users. For anonymous sessions, sums OR usage over
 * the last 7 days for `userId` (treated as `guest_session_id`) and throws
 * `GuestTrialExhausted` when the total has reached the $1 soft cap.
 */
export async function assertGuestNotExhausted(
  session: GuestCapSession,
): Promise<void> {
  if (!session.isAnonymous) return;
  const { totalUsd } = await getRecentSpendUsd(null, session.userId, 7);
  if (totalUsd >= OR_GUEST_SOFT_LIMIT_USD) {
    throw new GuestTrialExhausted();
  }
}

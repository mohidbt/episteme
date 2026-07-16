// GSD-141 — server-side Stripe client + tier↔price mapping.
//
// Test vs live is decided purely by which STRIPE_SECRET_KEY the env holds
// (sk_test_… on preview/dev, sk_live_… on prod). Price ids are likewise
// per-env, so the tier map reads them from env rather than hardcoding.

import Stripe from "stripe";
import type { SubscriptionTier } from "./subscription-tiers";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`[stripe] missing env ${name}`);
  return v;
}

// Lazy singleton — never constructed at import time so a missing key doesn't
// crash unrelated routes/builds.
let _stripe: Stripe | null = null;
export function stripe(): Stripe {
  if (!_stripe) {
    _stripe = new Stripe(required("STRIPE_SECRET_KEY"));
  }
  return _stripe;
}

export function priceIdForTier(tier: SubscriptionTier): string {
  return required(tier === "max" ? "STRIPE_PRICE_MAX" : "STRIPE_PRICE_HIGH");
}

// Reverse map for webhooks: the Stripe line-item price → our tier.
export function tierForPriceId(priceId: string): SubscriptionTier | null {
  if (priceId === process.env.STRIPE_PRICE_HIGH) return "high";
  if (priceId === process.env.STRIPE_PRICE_MAX) return "max";
  return null;
}

export function webhookSecret(): string {
  return required("STRIPE_WEBHOOK_SECRET");
}

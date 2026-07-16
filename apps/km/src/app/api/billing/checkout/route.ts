// GSD-141 — POST /api/billing/checkout
//
// Body: { tier: "high" | "max" }. Creates a Stripe Checkout Session in
// subscription mode and returns its hosted URL. The actual bucket/tier grant
// happens later, in the webhook (checkout.session.completed) — never here.

import { NextResponse } from "next/server";
import { requireNonGuestSession } from "@/lib/auth/require-non-guest";
import { stripe, priceIdForTier } from "@/lib/stripe";
import { loadSubscriptionFull } from "@/lib/subscription-store";
import { isSubscriptionTier } from "@/lib/subscription-tiers";

export async function POST(req: Request) {
  const auth = await requireNonGuestSession(req);
  if (!auth.ok) return auth.response;

  const body = (await req.json().catch(() => null)) as { tier?: string } | null;
  const tier = body?.tier;
  if (!tier || !isSubscriptionTier(tier)) {
    return NextResponse.json({ error: "invalid_tier" }, { status: 400 });
  }

  const origin = new URL(req.url).origin;
  const existing = await loadSubscriptionFull(auth.userId);

  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceIdForTier(tier), quantity: 1 }],
    // Reuse the Stripe customer across re-subscribes; otherwise Checkout mints
    // one and we capture it in the webhook.
    ...(existing?.stripeCustomerId
      ? { customer: existing.stripeCustomerId }
      : {}),
    client_reference_id: auth.userId,
    // Redundant with client_reference_id but survives onto the subscription
    // object, which later subscription.* events carry.
    subscription_data: { metadata: { userId: auth.userId } },
    success_url: `${origin}/settings/billing?checkout=success`,
    cancel_url: `${origin}/settings/billing?checkout=cancelled`,
  });

  if (!session.url) {
    return NextResponse.json({ error: "no_checkout_url" }, { status: 502 });
  }
  return NextResponse.json({ url: session.url });
}

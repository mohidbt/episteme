// GSD-141 — POST /api/billing/portal
//
// Opens the Stripe Customer Portal (manage/cancel/invoices) for the current
// user. Requires an existing Stripe customer, i.e. they've subscribed before.

import { NextResponse } from "next/server";
import { requireNonGuestSession } from "@/lib/auth/require-non-guest";
import { stripe } from "@/lib/stripe";
import { loadSubscriptionFull } from "@/lib/subscription-store";

export async function POST(req: Request) {
  const auth = await requireNonGuestSession(req);
  if (!auth.ok) return auth.response;

  const sub = await loadSubscriptionFull(auth.userId);
  if (!sub?.stripeCustomerId) {
    return NextResponse.json({ error: "no_customer" }, { status: 400 });
  }

  const origin = new URL(req.url).origin;
  const portal = await stripe().billingPortal.sessions.create({
    customer: sub.stripeCustomerId,
    return_url: `${origin}/settings/billing`,
  });
  return NextResponse.json({ url: portal.url });
}

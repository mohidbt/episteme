// GSD-141 — POST /api/billing/webhook
//
// Stripe → us. Signature-verified, idempotent. Translates Stripe subscription
// lifecycle into our state machine:
//   checkout.session.completed        → activate (mint weekly bucket)
//   customer.subscription.updated     → activate (tier change/resume) OR cancel
//   customer.subscription.deleted     → cancel (lapse to trial bucket)
//
// Idempotency: we reconcile against the current DB row and only run the
// (bucket-churning) state transition when tier/status actually changes.
// Stripe re-delivers and fires several events per checkout, so a naive
// "activate on every event" would rebuild the OR key repeatedly and wipe the
// user's partial weekly usage.

import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe, webhookSecret, tierForPriceId } from "@/lib/stripe";
import {
  activateSubscription,
  cancelSubscription,
} from "@/lib/subscription-bucket";
import {
  loadSubscription,
  saveStripeLinkage,
  findUserByStripeCustomerId,
  type StripeLinkage,
} from "@/lib/subscription-store";
import type { SubscriptionTier } from "@/lib/subscription-tiers";

export const runtime = "nodejs";

function toDate(unix: number | null | undefined): Date | null {
  return typeof unix === "number" ? new Date(unix * 1000) : null;
}

// Stripe moved current_period_* from the subscription onto its items; read
// whichever the account's API version exposes.
function periodOf(sub: Stripe.Subscription): { start: Date | null; end: Date | null } {
  const item = sub.items?.data?.[0] as
    | { current_period_start?: number; current_period_end?: number }
    | undefined;
  const legacy = sub as unknown as {
    current_period_start?: number;
    current_period_end?: number;
  };
  return {
    start: toDate(item?.current_period_start ?? legacy.current_period_start),
    end: toDate(item?.current_period_end ?? legacy.current_period_end),
  };
}

// A Stripe subscription counts as "granting the tier" only while live.
function isLiveStatus(status: Stripe.Subscription.Status): boolean {
  return status === "active" || status === "trialing";
}

async function reconcile(
  userId: string,
  desired: { tier: SubscriptionTier; active: boolean },
  linkage: StripeLinkage,
): Promise<void> {
  const current = await loadSubscription(userId);
  const desiredStatus = desired.active ? "active" : "canceled";
  const unchanged =
    current?.status === desiredStatus &&
    (!desired.active || current?.tier === desired.tier);

  if (!unchanged) {
    if (desired.active) {
      await activateSubscription(userId, desired.tier);
    } else {
      await cancelSubscription(userId);
    }
  }
  // Always refresh linkage (cheap, no bucket churn) so ids/period stay current.
  await saveStripeLinkage(userId, linkage);
}

async function handleSubscription(sub: Stripe.Subscription): Promise<void> {
  const customerId =
    typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const userId =
    (sub.metadata?.userId as string | undefined) ??
    (await findUserByStripeCustomerId(customerId));
  if (!userId) {
    console.warn(`[billing/webhook] no user for stripe customer ${customerId}`);
    return;
  }

  const priceId = sub.items?.data?.[0]?.price?.id ?? null;
  const tier = priceId ? tierForPriceId(priceId) : null;
  const period = periodOf(sub);
  const linkage: StripeLinkage = {
    stripeCustomerId: customerId,
    stripeSubscriptionId: sub.id,
    priceId,
    currentPeriodStart: period.start,
    currentPeriodEnd: period.end,
  };

  const active = isLiveStatus(sub.status) && tier !== null;
  // Cancel keeps the last known tier; only active needs a resolved tier.
  await reconcile(
    userId,
    { tier: (tier ?? "high") as SubscriptionTier, active },
    linkage,
  );
}

export async function POST(req: Request) {
  const sig = req.headers.get("stripe-signature");
  if (!sig) {
    return NextResponse.json({ error: "missing_signature" }, { status: 400 });
  }

  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(raw, sig, webhookSecret());
  } catch (err) {
    console.warn("[billing/webhook] signature verification failed", err);
    return NextResponse.json({ error: "bad_signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode !== "subscription" || !session.subscription) break;
        const subId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription.id;
        // Retrieve to get line-item price + status (session omits them).
        const sub = await stripe().subscriptions.retrieve(subId);
        // Carry the userId from the session in case metadata didn't propagate.
        if (session.client_reference_id && !sub.metadata?.userId) {
          sub.metadata = {
            ...sub.metadata,
            userId: session.client_reference_id,
          };
        }
        await handleSubscription(sub);
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        await handleSubscription(event.data.object as Stripe.Subscription);
        break;
      }
      default:
        break;
    }
  } catch (err) {
    // Return 500 so Stripe retries — the handler is idempotent.
    console.error(`[billing/webhook] handler failed for ${event.type}`, err);
    return NextResponse.json({ error: "handler_failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

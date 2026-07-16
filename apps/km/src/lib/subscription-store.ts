// GSD-140 — DB helpers for the user_subscriptions table.
//
// Thin layer (mirrors user-bucket-store) so the state-machine tests can
// mock these without the drizzle stack. GSD-141 webhooks drive the
// triggers; here we only own the row read/write.

import { db } from "@/lib/db";
import { userSubscriptions } from "@episteme/db/schema";
import { eq } from "drizzle-orm";
import type { SubscriptionTier } from "./subscription-tiers";

export interface SubscriptionRow {
  tier: SubscriptionTier;
  status: "active" | "canceled";
}

export async function loadSubscription(
  userId: string,
): Promise<SubscriptionRow | null> {
  const rows = await db
    .select({
      tier: userSubscriptions.tier,
      status: userSubscriptions.status,
    })
    .from(userSubscriptions)
    .where(eq(userSubscriptions.userId, userId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    tier: row.tier as SubscriptionTier,
    status: row.status as "active" | "canceled",
  };
}

// GSD-141 — full row incl. Stripe linkage, for the checkout/portal routes and
// the /settings/billing page.
export interface SubscriptionFullRow extends SubscriptionRow {
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  priceId: string | null;
}

export async function loadSubscriptionFull(
  userId: string,
): Promise<SubscriptionFullRow | null> {
  const rows = await db
    .select({
      tier: userSubscriptions.tier,
      status: userSubscriptions.status,
      stripeCustomerId: userSubscriptions.stripeCustomerId,
      stripeSubscriptionId: userSubscriptions.stripeSubscriptionId,
      priceId: userSubscriptions.priceId,
    })
    .from(userSubscriptions)
    .where(eq(userSubscriptions.userId, userId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    tier: row.tier as SubscriptionTier,
    status: row.status as "active" | "canceled",
    stripeCustomerId: row.stripeCustomerId,
    stripeSubscriptionId: row.stripeSubscriptionId,
    priceId: row.priceId,
  };
}

// Reverse-lookup for subscription.updated/.deleted webhooks, which carry the
// Stripe customer id, not our user id.
export async function findUserByStripeCustomerId(
  stripeCustomerId: string,
): Promise<string | null> {
  const rows = await db
    .select({ userId: userSubscriptions.userId })
    .from(userSubscriptions)
    .where(eq(userSubscriptions.stripeCustomerId, stripeCustomerId))
    .limit(1);
  return rows[0]?.userId ?? null;
}

// Persist Stripe linkage onto an existing row (the tier/status row is written
// first by the state machine's activateSubscription). UPDATE-only — never
// creates a row, so it can't violate the NOT NULL tier column.
export interface StripeLinkage {
  stripeCustomerId: string;
  stripeSubscriptionId: string | null;
  priceId: string | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
}

export async function saveStripeLinkage(
  userId: string,
  linkage: StripeLinkage,
): Promise<void> {
  await db
    .update(userSubscriptions)
    .set({
      stripeCustomerId: linkage.stripeCustomerId,
      stripeSubscriptionId: linkage.stripeSubscriptionId,
      priceId: linkage.priceId,
      currentPeriodStart: linkage.currentPeriodStart,
      currentPeriodEnd: linkage.currentPeriodEnd,
      updatedAt: new Date(),
    })
    .where(eq(userSubscriptions.userId, userId));
}

export interface UpsertSubscriptionInput {
  userId: string;
  tier: SubscriptionTier;
  status: "active" | "canceled";
}

export async function upsertSubscription(
  input: UpsertSubscriptionInput,
): Promise<void> {
  await db
    .insert(userSubscriptions)
    .values({
      userId: input.userId,
      tier: input.tier,
      status: input.status,
    })
    .onConflictDoUpdate({
      target: userSubscriptions.userId,
      set: {
        tier: input.tier,
        status: input.status,
        updatedAt: new Date(),
      },
    });
}

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

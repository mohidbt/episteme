// GSD-140 — paid-subscription bucket transitions + state machine.
//
// GSD-141 Stripe webhooks call activate/cancel/resume; the actual triggers
// are out of scope here. Each transition both updates user_subscriptions and
// rebuilds the user's managed OpenRouter bucket to the right weekly limit.
//
// Bucket transition uses Option B (DELETE old key + POST fresh weekly bucket)
// — unconditionally correct vs PATCH-usage-reset semantics, and matches the
// no-rollover fairness rule (a fresh key starts the weekly window at $0).

import {
  createUserBucketWithConfig,
  deleteUserBucket,
} from "./openrouter-provisioning";
import { loadUserBucket, updateUserBucket } from "./user-bucket-store";
import { loadSubscription, upsertSubscription } from "./subscription-store";
import {
  bucketConfigForTier,
  type SubscriptionTier,
} from "./subscription-tiers";

interface ReplaceBucketConfig {
  limit: number;
  label: string;
  limitReset: "weekly" | null;
  /** tier string persisted on the bucket row ('high' | 'max' | 'trial'). */
  tier: string;
}

// Safe ordering: POST new → persist row → DELETE old.
//   • If POST or persist throws, the OLD key is still in the DB and still
//     valid — the user never goes keyless.
//   • The DELETE of the old key is best-effort: once the new key is persisted
//     the user is already working, so a DELETE failure must NOT throw. The
//     old key is orphaned (bounded $ leak, GSD-131 cleanup) and logged.
//   • The old hash is captured BEFORE the update so we can still revoke it.
async function rebuildBucket(
  userId: string,
  config: ReplaceBucketConfig,
): Promise<void> {
  const existing = await loadUserBucket(userId);
  const oldHash = existing?.hash ?? null;

  const minted = await createUserBucketWithConfig(userId, {
    limit: config.limit,
    label: config.label,
    limitReset: config.limitReset,
  });

  await updateUserBucket({
    userId,
    runtimeKey: minted.key,
    hash: minted.hash,
    tier: config.tier,
    limitUsd: config.limit,
    limitReset: config.limitReset,
  });

  if (oldHash && oldHash !== minted.hash) {
    try {
      await deleteUserBucket(oldHash);
    } catch (err) {
      console.warn(
        `[subscription-bucket] failed to delete old OR key ${oldHash} for ${userId} — orphaned, needs cleanup`,
        err,
      );
    }
  }
}

/** Swap the user's managed bucket to a paid tier's weekly limit. */
export async function replaceUserBucket(
  userId: string,
  tier: SubscriptionTier,
): Promise<void> {
  const cfg = bucketConfigForTier(tier);
  await rebuildBucket(userId, {
    limit: cfg.limit,
    label: cfg.label,
    limitReset: cfg.limitReset,
    tier,
  });
}

/** Revert the user's bucket to the one-time $5 trial (no weekly reset). */
async function revertToTrialBucket(userId: string): Promise<void> {
  await rebuildBucket(userId, {
    limit: 5,
    label: "trial",
    limitReset: null,
    tier: "trial",
  });
}

export async function activateSubscription(
  userId: string,
  tier: SubscriptionTier,
): Promise<void> {
  await upsertSubscription({ userId, tier, status: "active" });
  await replaceUserBucket(userId, tier);
}

// Cancel semantics (minimal, no rollover): mark canceled and lapse the bucket
// back to trial behavior — a fresh one-time $5 cap. We keep the row (with its
// last tier) so GSD-141 can resume without re-collecting the tier.
export async function cancelSubscription(userId: string): Promise<void> {
  const sub = await loadSubscription(userId);
  if (!sub) return;
  await upsertSubscription({
    userId,
    tier: sub.tier,
    status: "canceled",
  });
  await revertToTrialBucket(userId);
}

export async function resumeSubscription(userId: string): Promise<void> {
  const sub = await loadSubscription(userId);
  if (!sub) return;
  await upsertSubscription({
    userId,
    tier: sub.tier,
    status: "active",
  });
  await replaceUserBucket(userId, sub.tier);
}

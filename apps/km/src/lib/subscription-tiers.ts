// GSD-140 — paid subscription tiers → OpenRouter managed-bucket config.
//
// The € figure is the price; the OR bucket limit is the lower USD number
// passed to the Provisioning API (margin lives in the gap).
//   High  €2.50/wk → bucket limit $2/wk
//   Max   €5.00/wk → bucket limit $4/wk
// Both reset weekly (Mon–Sun UTC, OR-native), no rollover.

export type SubscriptionTier = "high" | "max";

export interface BucketConfig {
  /** USD spend cap passed to OpenRouter as `limit`. */
  limit: number;
  /** OpenRouter `limit_reset` cadence. */
  limitReset: "weekly";
  /** OpenRouter key `label`. */
  label: string;
}

const TIER_BUCKETS: Record<SubscriptionTier, BucketConfig> = {
  high: { limit: 2, limitReset: "weekly", label: "high" },
  max: { limit: 4, limitReset: "weekly", label: "max" },
};

export function bucketConfigForTier(tier: SubscriptionTier): BucketConfig {
  return TIER_BUCKETS[tier];
}

export function isSubscriptionTier(value: string): value is SubscriptionTier {
  return value === "high" || value === "max";
}

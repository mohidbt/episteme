// GSD-141 — /settings/billing
//
// Current plan + weekly AI-usage bar + subscribe/manage CTAs. The bucket-usage
// read mirrors the Data settings page (OR `/keys/{hash}` is the truth source),
// trimmed to the paying-user path.

import { getCurrentSession } from "@/lib/session";
import {
  OR_USER_SOFT_LIMIT_USD,
  getRecentSpendUsd,
} from "@/lib/openrouter-usage";
import { loadUserBucket } from "@/lib/user-bucket-store";
import { getUserBucketUsage } from "@/lib/openrouter-provisioning";
import { loadSubscriptionFull } from "@/lib/subscription-store";
import { OrUsage } from "../data/OrUsage";
import { BillingActions } from "./BillingActions";

const TIER_LABEL = { high: "High", max: "Max" } as const;

export default async function BillingSettingsPage() {
  const session = await getCurrentSession();

  if (!session || session.isAnonymous) {
    return (
      <div className="mx-auto max-w-lg px-6 py-10">
        <h1 className="font-display text-2xl mb-1">Billing</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Sign up to subscribe and unlock more AI usage and storage.
        </p>
        <a
          href="/sign-up"
          className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Sign up
        </a>
      </div>
    );
  }

  const userId = session.userId;
  const sub = await loadSubscriptionFull(userId);
  const activeTier = sub?.status === "active" ? sub.tier : null;
  const wasCancelled = sub?.status === "canceled";

  // Weekly usage bar — OR-reported on the managed bucket, soft-limit fallback.
  const bucket = await loadUserBucket(userId).catch(() => null);
  let totalUsd = 0;
  let limitUsd = OR_USER_SOFT_LIMIT_USD;
  let byModel: Array<{ model: string; usd: number }> = [];
  if (bucket?.hash) {
    try {
      const r = await getUserBucketUsage(bucket.hash);
      totalUsd = r.usageUsd;
      limitUsd = r.limitUsd;
    } catch {
      const spend = await getRecentSpendUsd(userId, null, 30);
      totalUsd = spend.totalUsd;
      byModel = spend.byModel;
    }
  }

  const planName = activeTier ? TIER_LABEL[activeTier] : "Free trial";

  return (
    <div className="mx-auto max-w-lg px-6 py-10">
      <h1 className="font-display text-2xl mb-1">Billing</h1>
      <p className="text-sm text-muted-foreground mb-8">
        Manage your subscription and AI usage.
      </p>

      <div className="divide-y divide-border rounded-lg border border-border bg-background">
        <div className="px-4 py-4">
          <div className="text-sm font-medium mb-1">Current plan</div>
          <div className="flex items-center gap-2">
            <span className="text-lg font-display">{planName}</span>
            {wasCancelled && (
              <span className="text-xs text-muted-foreground">
                (cancelled — reverts to trial limits)
              </span>
            )}
          </div>
        </div>

        <div className="px-4 py-4">
          <div className="text-sm font-medium mb-3">Weekly AI usage</div>
          <OrUsage
            usage={{
              totalUsd,
              byModel,
              isGuest: false,
              limitUsd,
              isWeekly: true,
            }}
          />
        </div>

        <div className="px-4 py-4">
          <BillingActions activeTier={activeTier} />
        </div>
      </div>
    </div>
  );
}

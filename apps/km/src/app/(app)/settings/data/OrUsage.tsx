// GSD-126 P0 / GSD-140 P1 — bar-only AI usage panel.
//
// Numeric "$X / $5 — 30-day spend" readout removed across the board. We
// keep only the bar + an "Over budget" badge. Label is conditional:
//   • guest          → "AI usage"      (no time qualifier)
//   • trial signed-in→ "Weekly usage"  (cosmetic; trial bucket is one-time $5,
//                                        label leads with the future — P0)
//   • paying (weekly)→ "Weekly usage"  (GSD-140: now genuinely a weekly window;
//                                        the OR bucket resets weekly Mon-Sun UTC)
//
// Signed-in `totalUsd` is sourced upstream from OR's `/api/v1/keys/{hash}`
// (truth source), not the local catalog estimate. Guests stay on local
// 7-day sum until they sign up + get a managed bucket.

export interface OrUsageData {
  totalUsd: number;
  byModel: Array<{ model: string; usd: number }>;
  isGuest: boolean;
  limitUsd: number;
  /** GSD-140: true when the OR bucket resets weekly (paying tier). */
  isWeekly?: boolean;
}

export function OrUsage({ usage }: { usage: OrUsageData }) {
  const { totalUsd, limitUsd, isGuest, isWeekly } = usage;
  const overLimit = totalUsd > limitUsd;
  const pctRaw = limitUsd > 0 ? (totalUsd / limitUsd) * 100 : 0;
  // Clamp the visible bar to [0,100]; the badge communicates over-limit.
  const pct = Math.max(0, Math.min(100, pctRaw));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span
          className="text-sm text-muted-foreground"
          data-or-usage-weekly={isWeekly ? "true" : "false"}
        >
          {isGuest ? "AI usage" : "Weekly usage"}
        </span>
        {overLimit && (
          <span
            className="inline-flex items-center rounded-md bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/40 dark:text-red-300"
            data-testid="or-usage-over-badge"
          >
            Over budget
          </span>
        )}
      </div>
      <div
        data-testid="or-usage-bar"
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          data-testid="or-usage-fill"
          className={
            overLimit
              ? "h-full bg-red-500 transition-[width]"
              : "h-full bg-primary transition-[width]"
          }
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

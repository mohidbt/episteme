// Round C — /settings/data OR-spend panel. Mirrors DriveUsage shape so the
// two rows line up vertically inside the same card.

export interface OrUsageData {
  totalUsd: number;
  byModel: Array<{ model: string; usd: number }>;
  isGuest: boolean;
  limitUsd: number;
}

function fmtUsd(n: number): string {
  // Always two decimals — "$1.23", "$0.50", "$5.00". Keeps the bar legend
  // a stable width across renders.
  return `$${n.toFixed(2)}`;
}

export function OrUsage({ usage }: { usage: OrUsageData }) {
  const { totalUsd, limitUsd } = usage;
  const overLimit = totalUsd > limitUsd;
  const pctRaw = limitUsd > 0 ? (totalUsd / limitUsd) * 100 : 0;
  // Clamp the visible bar to [0,100]; the badge communicates over-limit.
  const pct = Math.max(0, Math.min(100, pctRaw));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm">
          {fmtUsd(totalUsd)} / {fmtUsd(limitUsd)}{" "}
          <span className="text-muted-foreground">— 30-day spend</span>
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

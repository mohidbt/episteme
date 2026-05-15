import { LIBRARY_BYTES_LIMIT, type LibraryUsage } from "@/lib/library-usage";

function toMB(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  // Render whole numbers without trailing ".0" (matches "10 MB" not "10.0 MB"),
  // but keep one decimal for fractional values so the bar is meaningful.
  return Number.isInteger(mb) ? `${mb} MB` : `${mb.toFixed(1)} MB`;
}

export function DriveUsage({ usage }: { usage: LibraryUsage }) {
  const limitMB = LIBRARY_BYTES_LIMIT / (1024 * 1024);
  const pctRaw = (usage.total / LIBRARY_BYTES_LIMIT) * 100;
  const overLimit = usage.total > LIBRARY_BYTES_LIMIT;
  // Clamp the visible bar to [0,100] so over-limit doesn't render an
  // off-the-end blue stripe; the badge communicates the actual state.
  const pct = Math.max(0, Math.min(100, pctRaw));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm">
          {toMB(usage.total)} / {limitMB} MB used
        </span>
        {overLimit && (
          <span
            className="inline-flex items-center rounded-md bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/40 dark:text-red-300"
            data-testid="drive-usage-over-badge"
          >
            Over limit
          </span>
        )}
      </div>
      <div
        data-testid="drive-usage-bar"
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          data-testid="drive-usage-fill"
          className={
            overLimit
              ? "h-full bg-red-500 transition-[width]"
              : "h-full bg-primary transition-[width]"
          }
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="text-xs text-muted-foreground">
        Papers {toMB(usage.papers)} · Notes {toMB(usage.notes)} · Assets {toMB(usage.assets)}
      </div>
    </div>
  );
}

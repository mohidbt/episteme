export function PaperPdfPreview({
  paperId,
  title,
}: {
  paperId: string;
  title: string;
}) {
  return (
    <div className="flex h-full min-h-[60vh] items-center justify-center overflow-hidden bg-[linear-gradient(180deg,hsl(var(--muted)/0.28),hsl(var(--background)))] px-8 py-10 lg:min-h-0">
      <figure className="flex w-full max-w-[420px] flex-col items-center gap-4">
        <div className="relative w-full max-w-[340px]">
          <div
            aria-hidden
            className="absolute inset-0 translate-x-3 translate-y-3 rounded-sm border border-border/50 bg-background shadow-sm"
          />
          <div
            aria-hidden
            className="absolute inset-0 translate-x-1.5 translate-y-1.5 rounded-sm border border-border/60 bg-background shadow-sm"
          />
          <div className="relative aspect-[3/4] overflow-hidden rounded-sm border border-border bg-background shadow-[0_18px_50px_hsl(var(--foreground)/0.12)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/papers/${paperId}/cover`}
              alt={`First page preview for ${title}`}
              className="h-full w-full bg-white object-contain"
            />
          </div>
        </div>
        <figcaption className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
          First page preview
        </figcaption>
      </figure>
    </div>
  );
}

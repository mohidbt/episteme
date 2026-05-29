export function PaperPdfPreview({
  paperId,
  title,
}: {
  paperId: string;
  title: string;
}) {
  return (
    <div className="relative h-full aspect-[3/4] bg-[linear-gradient(180deg,hsl(var(--muted)/0.28),hsl(var(--background)))]">
      <div
        aria-hidden
        className="absolute inset-0 translate-x-3 translate-y-3 rounded-sm border border-border/50 bg-background shadow-sm"
      />
      <div
        aria-hidden
        className="absolute inset-0 translate-x-1.5 translate-y-1.5 rounded-sm border border-border/60 bg-background shadow-sm"
      />
      <div className="relative h-full w-full overflow-hidden rounded-sm border border-border bg-background shadow-[0_18px_50px_hsl(var(--foreground)/0.12)]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/papers/${paperId}/cover`}
          alt={`First page of ${title}`}
          className="h-full w-full bg-white object-contain"
        />
      </div>
    </div>
  );
}

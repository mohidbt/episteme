import Image from "next/image";
import { Badge } from "@/components/ui/badge";

export type TourPreviewCardProps = {
  title: string;
  caption: string;
  mediaSrc?: string;
  mediaAlt: string;
  previewBadge?: boolean;
};

export function TourPreviewCard({
  title,
  caption,
  mediaSrc,
  mediaAlt,
  previewBadge = true,
}: TourPreviewCardProps) {
  return (
    <div data-testid="tour-preview-card" className="flex flex-col gap-3 text-left">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base font-semibold leading-tight">{title}</h3>
        {previewBadge ? (
          <Badge variant="secondary" data-testid="tour-preview-badge">
            Preview
          </Badge>
        ) : null}
      </div>
      {mediaSrc ? (
        <div className="overflow-hidden rounded-md border border-border bg-muted">
          <Image
            src={mediaSrc}
            alt={mediaAlt}
            width={480}
            height={270}
            className="h-auto w-full"
            unoptimized
          />
        </div>
      ) : null}
      <p className="text-sm leading-snug text-muted-foreground">{caption}</p>
    </div>
  );
}

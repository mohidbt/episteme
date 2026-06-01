import Image from "next/image";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

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
    <Card
      data-testid="tour-preview-card"
      className="gap-3 border-0 bg-transparent py-0 text-left shadow-none"
    >
      <CardHeader className="px-0">
        <CardTitle className="text-base leading-tight">{title}</CardTitle>
        {previewBadge ? (
          <CardAction>
            <Badge variant="secondary" data-testid="tour-preview-badge">
              Preview
            </Badge>
          </CardAction>
        ) : null}
      </CardHeader>
      {mediaSrc ? (
        <CardContent className="px-0">
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
        </CardContent>
      ) : null}
      <CardContent className="px-0">
        <CardDescription className="leading-snug">{caption}</CardDescription>
      </CardContent>
    </Card>
  );
}

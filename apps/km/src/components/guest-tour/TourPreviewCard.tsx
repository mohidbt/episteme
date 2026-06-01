import Link from "next/link";
import Image from "next/image";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export type TourPreviewCardCta = {
  label: string;
  href: string;
  onClick?: () => void;
};

export type TourPreviewCardProps = {
  title: string;
  caption: string;
  mediaSrc?: string;
  mediaAlt: string;
  previewBadge?: boolean;
  cta?: TourPreviewCardCta;
};

export function TourPreviewCard({
  title,
  caption,
  mediaSrc,
  mediaAlt,
  previewBadge = true,
  cta,
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
      {cta ? (
        <CardContent className="px-0 pt-1">
          <Link
            href={cta.href}
            onClick={cta.onClick}
            data-testid="tour-cta-button"
            className={cn(buttonVariants({ size: "lg" }))}
          >
            {cta.label}
          </Link>
        </CardContent>
      ) : null}
    </Card>
  );
}

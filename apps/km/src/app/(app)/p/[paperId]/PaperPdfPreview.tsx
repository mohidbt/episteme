"use client";

import dynamic from "next/dynamic";

const Reader = dynamic(
  () => import("@episteme/reader").then((m) => m.Reader),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full min-h-[60vh] items-center justify-center bg-muted/30 text-sm text-muted-foreground">
        Loading PDF...
      </div>
    ),
  },
);

export function PaperPdfPreview({ paperId }: { paperId: string }) {
  return (
    <div className="h-full min-h-[60vh] lg:min-h-0">
      <Reader paperId={paperId} mode="lite" />
    </div>
  );
}

"use client";

import dynamic from "next/dynamic";

const Reader = dynamic(
  () => import("@episteme/reader").then((m) => m.Reader),
  { ssr: false, loading: () => <div data-reader-loading>Loading…</div> },
);

export function ReaderClient({ paperId }: { paperId: string }) {
  return <Reader paperId={paperId} mode="full" />;
}

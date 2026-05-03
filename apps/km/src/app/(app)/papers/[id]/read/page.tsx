import { cache } from "react";
import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import dynamic from "next/dynamic";

import { getRequiredUserId } from "@/lib/session";
import { db } from "@/lib/db";
import { papers } from "@episteme/db/schema";

const Reader = dynamic(
  () => import("@episteme/reader").then((m) => m.Reader),
  { ssr: false, loading: () => <div data-reader-loading>Loading…</div> },
);

const loadPaper = cache(async (paperId: string, userId: string) => {
  const rows = await db
    .select({ id: papers.id })
    .from(papers)
    .where(and(eq(papers.id, paperId), eq(papers.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
});

export default async function PaperReadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const userId = await getRequiredUserId();
  const { id } = await params;
  const paper = await loadPaper(id, userId);
  if (!paper) notFound();

  return (
    <div className="h-full min-h-0">
      <Reader paperId={paper.id} mode="full" />
    </div>
  );
}

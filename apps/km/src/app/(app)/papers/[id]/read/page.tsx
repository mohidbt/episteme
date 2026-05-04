import { cache } from "react";
import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";

import { getRequiredUserId } from "@/lib/session";
import { db } from "@/lib/db";
import { papers } from "@episteme/db/schema";
import { TabTitleUpdater } from "@/components/TabBar";

import { ReaderShell } from "./ReaderShell";

const loadPaper = cache(async (paperId: string, userId: string) => {
  const rows = await db
    .select({ id: papers.id, title: papers.title, filename: papers.filename })
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
  const tabTitle = (paper.title?.trim() || paper.filename).replace(/\.pdf$/i, "");

  return (
    <div className="h-full min-h-0 overflow-hidden">
      <TabTitleUpdater href={`/papers/${paper.id}/read`} title={tabTitle} />
      <ReaderShell paperId={paper.id} />
    </div>
  );
}

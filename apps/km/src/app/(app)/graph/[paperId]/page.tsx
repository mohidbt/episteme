import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { papers } from "@episteme/db/schema";
import { getRequiredUserId } from "@/lib/session";
import GraphView from "../GraphView.client";
import {
  nodesForUser,
  edgesWikiLink,
  edgesSharedTag,
  edgesPaperCitations,
} from "@/lib/graph/live-edges";
import type { GraphPayload } from "@/lib/graph/types";

type Ctx = { params: Promise<{ paperId: string }> };

async function loadPayload(userId: string): Promise<GraphPayload> {
  const [nodes, wikiLink, sharedTag, paperCitations] = await Promise.all([
    nodesForUser(userId),
    edgesWikiLink(userId),
    edgesSharedTag(userId),
    edgesPaperCitations(userId),
  ]);
  return {
    nodes,
    edges: [...wikiLink, ...sharedTag, ...paperCitations],
  };
}

export default async function GraphForPaperPage({ params }: Ctx) {
  const userId = await getRequiredUserId();
  const { paperId } = await params;

  const [paperRow] = await db
    .select({ id: papers.id, userId: papers.userId, title: papers.title })
    .from(papers)
    .where(eq(papers.id, paperId))
    .limit(1);

  if (!paperRow || paperRow.userId !== userId) {
    notFound();
  }

  const payload = await loadPayload(userId);

  return (
    <div className="flex h-[calc(100vh-4rem)] w-full flex-col">
      <div className="sticky top-0 z-10 border-b border-border bg-background/80 px-6 py-3 backdrop-blur">
        <h1 className="text-lg font-semibold">
          {paperRow.title ?? "(untitled paper)"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {payload.nodes.length} nodes · {payload.edges.length} edges
        </p>
      </div>
      <div className="relative flex-1">
        <GraphView payload={payload} />
      </div>
    </div>
  );
}

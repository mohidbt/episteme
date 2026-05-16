import { NextRequest, NextResponse } from "next/server";
import { papers } from "@episteme/db/schema";
import { getUserIdFromRequest } from "@/lib/auth";
import { jsonError, requireOwned } from "@/lib/crud";
import { autoLinkPaperCitations } from "@/lib/citations/auto-link";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };
type PaperRow = typeof papers.$inferSelect;

// D2: manual rematch — re-run paper_citations auto-link for a paper.
// Returns {linked} with the count of NEW edges inserted (existing edges
// are no-ops via ON CONFLICT DO NOTHING).
export async function POST(request: NextRequest, { params }: Ctx) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return jsonError(401, "unauthorized");

  const { id: paperId } = await params;

  const owned = await requireOwned<PaperRow>(papers, paperId, userId);
  if (!owned.ok)
    return jsonError(owned.status, owned.status === 404 ? "not_found" : "forbidden");

  const result = await autoLinkPaperCitations(paperId);
  return NextResponse.json(result, { status: 200 });
}

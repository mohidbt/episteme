import { NextRequest, NextResponse } from "next/server";
import { papers } from "@episteme/db/schema";
import { getUserIdFromRequest } from "@/lib/auth";
import { jsonError, requireOwned } from "@/lib/crud";
import { enrichPaperReferencesInDb } from "@/lib/citations/enrich-paper";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };
type PaperRow = typeof papers.$inferSelect;

export async function POST(request: NextRequest, { params }: Ctx) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return jsonError(401, "unauthorized");

  const { id: paperId } = await params;

  const owned = await requireOwned<PaperRow>(papers, paperId, userId);
  if (!owned.ok) return jsonError(owned.status, owned.status === 404 ? "not_found" : "forbidden");

  try {
    const { enriched, total } = await enrichPaperReferencesInDb(paperId, userId);
    return NextResponse.json({ enriched, total });
  } catch (err) {
    console.error("[citations/enrich] failed for paper", paperId, err);
    return jsonError(500, "internal server error");
  }
}

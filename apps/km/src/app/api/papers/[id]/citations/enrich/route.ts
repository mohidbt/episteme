import { NextResponse } from "next/server";
import { papers } from "@episteme/db/schema";
import {
  getAuthedUserId,
  MissingInternalSecretError,
} from "@/lib/internal-auth";
import { jsonError, requireOwned } from "@/lib/crud";
// GSD-74: route through the lazy-on-view enrichment helper so the legacy POST
// path uses the same `enrichedAt IS NULL AND doi IS NOT NULL` truth-source as
// the GET `after()` hook + UI "enriching" chip. Stamps `enrichedAt` on success
// AND on no-S2-match (so refs durably clear instead of re-firing every open).
import { enrichRefsForPaperLazily } from "@/lib/citations/lazy-enrich";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };
type PaperRow = typeof papers.$inferSelect;

export async function POST(request: Request, { params }: Ctx) {
  let authed;
  try { authed = await getAuthedUserId(request); }
  catch (e) {
    if (e instanceof MissingInternalSecretError) return jsonError(500, "internal auth misconfigured");
    throw e;
  }
  if (!authed) return jsonError(401, "unauthorized");
  const userId = authed.userId;

  const { id: paperId } = await params;

  const owned = await requireOwned<PaperRow>(papers, paperId, userId);
  if (!owned.ok) return jsonError(owned.status, owned.status === 404 ? "not_found" : "forbidden");

  try {
    const { enriched, total } = await enrichRefsForPaperLazily(paperId, userId);
    return NextResponse.json({ enriched, total });
  } catch (err) {
    console.error("[citations/enrich] failed for paper", paperId, err);
    return jsonError(500, "internal server error");
  }
}

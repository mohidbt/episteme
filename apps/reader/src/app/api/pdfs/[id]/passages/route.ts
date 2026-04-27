/**
 * GET /api/pdfs/:id/passages?q=&k= — return passages from a PDF that match
 * the query. Stub-quality: filters `document_segments.payload.text` with a
 * Postgres `ilike` and caps at `k`. Phase 1.5 swaps in pgvector retrieval.
 *
 * Wired for the agent `extract_passages` tool. Dual-auth: cookie OR HMAC.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@episteme/db";
import { documentSegments, documents } from "@episteme/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { getAuthedUserId } from "@/lib/internal-auth";

type Ctx = { params: Promise<{ id: string }> };
const DEFAULT_K = 5;
const MAX_K = 50;

export async function GET(request: NextRequest, { params }: Ctx) {
  const userId = await getAuthedUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const docId = parseInt(id, 10);
  if (isNaN(docId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  // Ownership check before exposing any segments.
  const [doc] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.id, docId), eq(documents.userId, userId)))
    .limit(1);
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const kRaw = Number(url.searchParams.get("k"));
  const k = Number.isFinite(kRaw) && kRaw > 0
    ? Math.min(Math.floor(kRaw), MAX_K)
    : DEFAULT_K;

  // TODO(1.5): swap ilike scan for pgvector cosine retrieval over
  // document_chunks.embedding. For now do a naive filter on payload.text.
  const conds = [eq(documentSegments.documentId, docId)];
  if (q.length > 0) {
    conds.push(sql`(${documentSegments.payload} ->> 'text') ILIKE ${`%${q}%`}`);
  }

  const rows = await db
    .select({
      id: documentSegments.id,
      page: documentSegments.page,
      kind: documentSegments.kind,
      bbox: documentSegments.bbox,
      payload: documentSegments.payload,
    })
    .from(documentSegments)
    .where(and(...conds))
    .limit(k);

  return NextResponse.json({ passages: rows });
}

/**
 * GET /api/papers/:id/passages?q=&k= — return passages from a PDF that match
 * the query. Stub-quality: filters `document_segments.payload.text` with a
 * Postgres `ilike` and caps at `k`. Phase 1.5 swaps in pgvector retrieval.
 *
 * Wired for the agent `extract_passages` tool. Dual-auth: cookie OR HMAC.
 */
import { NextRequest } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { documentSegments, papers } from "@episteme/db/schema";
import { getAuthedUserId, MissingInternalSecretError } from "@episteme/auth/internal";
import { jsonError, requireOwned } from "@/lib/crud";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };
type PaperRow = typeof papers.$inferSelect;

const DEFAULT_K = 5;
const MAX_K = 50;

export async function GET(request: NextRequest, { params }: Ctx) {
  let authed;
  try { authed = await getAuthedUserId(request); }
  catch (e) {
    if (e instanceof MissingInternalSecretError) {
      return jsonError(500, "internal auth misconfigured");
    }
    throw e;
  }
  if (!authed) return jsonError(401, "unauthorized");
  const userId = authed.userId;

  const { id } = await params;
  const owned = await requireOwned<PaperRow>(papers, id, userId);
  if (!owned.ok) return jsonError(owned.status, owned.status === 404 ? "not_found" : "forbidden");

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const kRaw = Number(url.searchParams.get("k"));
  const k = Number.isFinite(kRaw) && kRaw > 0
    ? Math.min(Math.floor(kRaw), MAX_K)
    : DEFAULT_K;

  // TODO(1.5): swap ilike scan for pgvector cosine retrieval over
  // document_chunks.embedding. For now do a naive filter on payload.text.
  const conds = [eq(documentSegments.paperId, id)];
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

  return Response.json({ passages: rows });
}

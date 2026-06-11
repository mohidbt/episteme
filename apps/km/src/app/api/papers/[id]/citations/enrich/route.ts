import { NextResponse, after } from "next/server";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { papers, documentReferences } from "@episteme/db/schema";
import {
  getAuthedUserId,
  MissingInternalSecretError,
} from "@/lib/internal-auth";
import { jsonError, requireOwned } from "@/lib/crud";
// GSD-74 round 3: fire-and-forget via `after()` so the POST doesn't sync-block
// for ~90s of S2 latency (76 refs × 1.1s per-row rate-limit ceiling). Returns
// the current unenriched-DOI count immediately so the agent tool + client can
// log/poll. Client GETs /citations to observe per-ref enrichment landing —
// PaperCitationsList already polls until every DOI ref flips to enrichedAt
// non-null.
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

  // Snapshot pending-DOI count so caller has a number to compare against on
  // subsequent GETs. Cheap COUNT query, doesn't block on S2.
  let total = 0;
  try {
    const pending = await db
      .select({ id: documentReferences.id })
      .from(documentReferences)
      .where(
        and(
          eq(documentReferences.paperId, paperId),
          isNull(documentReferences.enrichedAt),
          isNotNull(documentReferences.doi),
        ),
      );
    total = pending.length;
  } catch (err) {
    console.warn("[citations/enrich] pending-count probe failed for paper", paperId, err);
  }

  if (total > 0) {
    after(async () => {
      try {
        await enrichRefsForPaperLazily(paperId, userId);
      } catch (err) {
        console.warn("[citations/enrich] after() lazy-enrich failed for paper", paperId, err);
      }
    });
  }

  return NextResponse.json({ enriched: 0, total });
}

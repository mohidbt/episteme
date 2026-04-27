/**
 * GET /api/pdfs/:id/pages/:n/text — extract text for a single PDF page.
 *
 * Wired for the agent `get_page_text` tool. Currently extracts on-demand using
 * the same unpdf-based extractor used during upload; per-page caching is a
 * future optimization (TODO(1.5)).
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@episteme/db";
import { documents } from "@episteme/db/schema";
import { and, eq } from "drizzle-orm";
import { extractPdfPages } from "@/lib/ai/pdf-text";
import { getAuthedUserId, MissingInternalSecretError } from "@/lib/internal-auth";

type Ctx = { params: Promise<{ id: string; n: string }> };

export async function GET(request: NextRequest, { params }: Ctx) {
  let authed;
  try { authed = await getAuthedUserId(request); }
  catch (e) {
    if (e instanceof MissingInternalSecretError) {
      return NextResponse.json({ error: "internal auth misconfigured" }, { status: 500 });
    }
    throw e;
  }
  if (!authed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = authed.userId;

  const { id, n } = await params;
  const docId = parseInt(id, 10);
  const pageNum = parseInt(n, 10);
  if (isNaN(docId) || isNaN(pageNum) || pageNum < 1) {
    return NextResponse.json({ error: "Invalid id or page" }, { status: 400 });
  }

  const [doc] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, docId), eq(documents.userId, userId)))
    .limit(1);
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let pages;
  try {
    pages = await extractPdfPages(doc.filePath);
  } catch {
    return NextResponse.json({ error: "page text not extracted" }, { status: 404 });
  }
  const match = pages.find((p) => p.pageNumber === pageNum);
  if (!match) return NextResponse.json({ error: "page not found" }, { status: 404 });

  return NextResponse.json({ pageNumber: match.pageNumber, text: match.text });
}

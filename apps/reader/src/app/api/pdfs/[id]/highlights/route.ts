/**
 * POST /api/pdfs/:id/highlights — create a highlight from the agent tool.
 *
 * Wired for the agent `highlight` tool which sends {page, range, note?}.
 * The existing /api/documents/[id]/highlights endpoint uses a richer shape
 * (textContent, startOffset, endOffset, rects, ...). This route adapts the
 * agent payload onto the same user_highlights table.
 *
 * `range` is a string like "0-50" interpreted as <startOffset>-<endOffset>
 * character offsets. textContent is required by the schema; we store the
 * range string itself when the agent doesn't pass text.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@episteme/db";
import { documents, userHighlights } from "@episteme/db/schema";
import { and, eq } from "drizzle-orm";
import { getAuthedUserId } from "@/lib/internal-auth";

type Ctx = { params: Promise<{ id: string }> };

function parseRange(range: unknown): { start: number; end: number } | null {
  if (typeof range !== "string") return null;
  const m = /^(\d+)\s*-\s*(\d+)$/.exec(range);
  if (!m) return null;
  const start = Number(m[1]);
  const end = Number(m[2]);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return { start, end };
}

export async function POST(request: NextRequest, { params }: Ctx) {
  const rawBody = await request.text();
  const userId = await getAuthedUserId(request, rawBody);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const docId = parseInt(id, 10);
  if (isNaN(docId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  let body: Record<string, unknown> | null = null;
  try { body = JSON.parse(rawBody); } catch { /* leaves body=null */ }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 422 });
  }
  const page = (body as { page?: unknown }).page;
  const range = parseRange((body as { range?: unknown }).range);
  const note = (body as { note?: unknown }).note;
  if (typeof page !== "number" || page < 1 || !range) {
    return NextResponse.json({ error: "Invalid or missing fields" }, { status: 422 });
  }

  const [doc] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.id, docId), eq(documents.userId, userId)))
    .limit(1);
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const rangeStr = `${range.start}-${range.end}`;
  const [highlight] = await db
    .insert(userHighlights)
    .values({
      userId,
      documentId: docId,
      pageNumber: page,
      textContent: rangeStr,
      startOffset: range.start,
      endOffset: range.end,
      color: "yellow",
      note: typeof note === "string" ? note : null,
      rects: null,
    })
    .returning();

  return NextResponse.json({ highlight }, { status: 201 });
}

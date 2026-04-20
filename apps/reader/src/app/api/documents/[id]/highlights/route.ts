import { NextRequest, NextResponse } from "next/server";
import { auth } from "@episteme/auth/server";
import { db } from "@episteme/db";
import { userHighlights } from "@episteme/db/schema";
import { documents } from "@episteme/db/schema";
import { eq, and } from "drizzle-orm";

const VALID_COLORS = ["yellow", "green", "blue", "pink", "orange"] as const;
type HighlightColor = typeof VALID_COLORS[number];

type HighlightRect = { page: number; x0: number; y0: number; x1: number; y1: number };

function isValidRects(v: unknown): v is HighlightRect[] {
  return (
    Array.isArray(v) &&
    v.every((r) => {
      if (!r || typeof r !== "object") return false;
      const o = r as Record<string, unknown>;
      return (
        typeof o.page === "number" &&
        typeof o.x0 === "number" &&
        typeof o.y0 === "number" &&
        typeof o.x1 === "number" &&
        typeof o.y1 === "number"
      );
    })
  );
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const documentId = parseInt(id, 10);
  if (isNaN(documentId)) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });

  try {
    const highlights = await db
      .select()
      .from(userHighlights)
      .where(
        and(
          eq(userHighlights.documentId, documentId),
          eq(userHighlights.userId, session.user.id)
        )
      );

    return NextResponse.json({ highlights });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const documentId = parseInt(id, 10);
  if (isNaN(documentId)) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });

  const body = await request.json();

  const { pageNumber, textContent, startOffset, endOffset, color, note, rects } = body;

  if (
    typeof pageNumber !== "number" ||
    typeof textContent !== "string" || !textContent.trim() ||
    typeof startOffset !== "number" ||
    typeof endOffset !== "number"
  ) {
    return NextResponse.json({ error: "Invalid or missing fields" }, { status: 422 });
  }

  const resolvedColor: HighlightColor = (VALID_COLORS as readonly string[]).includes(color)
    ? color as HighlightColor
    : "yellow";

  try {
    const [doc] = await db
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.id, documentId), eq(documents.userId, session.user.id)))
      .limit(1);

    if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const [highlight] = await db
      .insert(userHighlights)
      .values({
        userId: session.user.id,
        documentId,
        pageNumber,
        textContent,
        startOffset,
        endOffset,
        color: resolvedColor,
        note: note ?? null,
        rects: isValidRects(rects) ? rects : null,
      })
      .returning();

    return NextResponse.json({ highlight }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  void id; // documentId context — ownership check uses highlightId + userId

  const url = new URL(request.url);
  const highlightId = parseInt(url.searchParams.get("highlightId") ?? "", 10);
  if (isNaN(highlightId)) return NextResponse.json({ error: "highlightId required" }, { status: 400 });

  try {
    const [existing] = await db
      .select()
      .from(userHighlights)
      .where(
        and(
          eq(userHighlights.id, highlightId),
          eq(userHighlights.userId, session.user.id)
        )
      )
      .limit(1);

    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await db.delete(userHighlights).where(
      and(eq(userHighlights.id, highlightId), eq(userHighlights.userId, session.user.id))
    );

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

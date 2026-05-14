/**
 * /api/user-highlights — rich PDF reader highlights backed by `user_highlights`.
 *
 * Distinct from /api/paper-highlights (sparse KM list view, paper_highlights table).
 * Ports the reader app's documents/[id]/highlights + pdfs/[id]/highlights routes
 * onto the post-A2 schema (paper_id uuid).
 */
import { and, asc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { papers, userHighlights } from "@episteme/db/schema";
import { getUserIdFromRequest } from "@/lib/auth";
import { jsonError, requireOwned } from "@/lib/crud";
import { schemaMismatchResponseIfNeeded } from "./schema-mismatch";
import {
  getAuthedUserId,
  MissingInternalSecretError,
} from "@episteme/auth/internal";

export const runtime = "nodejs";

type PaperRow = typeof papers.$inferSelect;

const VALID_COLORS = ["yellow", "green", "blue", "pink", "orange", "amber"] as const;

const rectSchema = z.object({
  page: z.number(),
  x0: z.number(),
  y0: z.number(),
  x1: z.number(),
  y1: z.number(),
});

const createSchema = z.object({
  paperId: z.string().uuid(),
  pageNumber: z.number().int().positive(),
  textContent: z.string().min(1),
  startOffset: z.number().int().nonnegative(),
  endOffset: z.number().int().nonnegative(),
  color: z.enum(VALID_COLORS).optional(),
  note: z.string().nullable().optional(),
  rects: z.array(rectSchema).nullable().optional(),
  source: z.enum(["user", "ai-auto"]).optional(),
  layerId: z.string().uuid().nullable().optional(),
});

export async function GET(req: Request) {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return jsonError(401, "unauthorized");
  const url = new URL(req.url);
  const paperId = url.searchParams.get("paperId");
  if (!paperId) return jsonError(400, "validation", { message: "paperId required" });

  const owned = await requireOwned<PaperRow>(papers, paperId, userId);
  if (!owned.ok) return jsonError(owned.status, owned.status === 404 ? "not_found" : "forbidden");

  let rows;
  try {
    // B6 — GET returns only user-authored highlights. AI-generated rows
    // (source = 'ai-auto') are exposed via /api/paper-highlights for the
    // reader sidebar's runs surface; serving them here causes duplicate
    // entries and breaks per-run grouping.
    rows = await db
      .select()
      .from(userHighlights)
      .where(
        and(
          eq(userHighlights.paperId, paperId),
          eq(userHighlights.userId, userId),
          ne(userHighlights.source, "ai-auto"),
        ),
      )
      .orderBy(asc(userHighlights.createdAt));
  } catch (error) {
    const schemaMismatch = schemaMismatchResponseIfNeeded(error);
    if (schemaMismatch) return schemaMismatch;
    throw error;
  }
  return Response.json({ highlights: rows });
}

export async function POST(req: Request) {
  // Read raw body once so HMAC verification can hash the exact bytes the
  // sender signed; subsequent JSON.parse uses the same string.
  const rawBody = await req.text();

  let authed;
  try {
    authed = await getAuthedUserId(req, rawBody);
  } catch (e) {
    if (e instanceof MissingInternalSecretError) {
      return jsonError(500, "internal_auth_misconfigured");
    }
    throw e;
  }
  if (!authed) return jsonError(401, "unauthorized");
  const userId = authed.userId;

  let body: unknown = null;
  try { body = JSON.parse(rawBody); } catch { /* leave null */ }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return jsonError(400, "validation", { issues: parsed.error.issues });

  const owned = await requireOwned<PaperRow>(papers, parsed.data.paperId, userId);
  if (!owned.ok) return jsonError(owned.status, owned.status === 404 ? "not_found" : "forbidden");

  let row;
  try {
    [row] = await db
      .insert(userHighlights)
      .values({
        userId,
        paperId: parsed.data.paperId,
        pageNumber: parsed.data.pageNumber,
        textContent: parsed.data.textContent,
        startOffset: parsed.data.startOffset,
        endOffset: parsed.data.endOffset,
        color: parsed.data.color ?? "yellow",
        note: parsed.data.note ?? null,
        rects: (parsed.data.rects ?? null) as typeof userHighlights.$inferInsert["rects"],
        source: parsed.data.source ?? "user",
        layerId: parsed.data.layerId ?? null,
      })
      .returning();
  } catch (error) {
    const schemaMismatch = schemaMismatchResponseIfNeeded(error);
    if (schemaMismatch) return schemaMismatch;
    throw error;
  }

  return Response.json({ highlight: row }, { status: 201 });
}

export async function DELETE(req: Request) {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return jsonError(401, "unauthorized");
  const url = new URL(req.url);
  const paperId = url.searchParams.get("paperId");
  if (!paperId) return jsonError(400, "validation", { message: "paperId required" });

  const owned = await requireOwned<PaperRow>(papers, paperId, userId);
  if (!owned.ok) return jsonError(owned.status, owned.status === 404 ? "not_found" : "forbidden");

  try {
    await db
      .delete(userHighlights)
      .where(
        and(
          eq(userHighlights.paperId, paperId),
          eq(userHighlights.userId, userId),
        ),
      );
  } catch (error) {
    const schemaMismatch = schemaMismatchResponseIfNeeded(error);
    if (schemaMismatch) return schemaMismatch;
    throw error;
  }
  return new Response(null, { status: 204 });
}

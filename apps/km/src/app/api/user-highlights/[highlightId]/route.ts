import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { userHighlights } from "@episteme/db/schema";
import {
  getAuthedUserId,
  MissingInternalSecretError,
} from "@/lib/internal-auth";
import { jsonError } from "@/lib/crud";
import { schemaMismatchResponseIfNeeded } from "../schema-mismatch";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ highlightId: string }> };

const patchSchema = z.object({
  comment: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
});

function parseHighlightId(raw: string): number | null {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

export async function PATCH(req: Request, { params }: Ctx) {
  const rawBody = await req.text();
  let authed;
  try { authed = await getAuthedUserId(req, rawBody); }
  catch (e) {
    if (e instanceof MissingInternalSecretError) return jsonError(500, "internal auth misconfigured");
    throw e;
  }
  if (!authed) return jsonError(401, "unauthorized");
  const userId = authed.userId;
  const { highlightId } = await params;
  const hId = parseHighlightId(highlightId);
  if (hId === null) return jsonError(400, "validation", { message: "invalid highlightId" });

  let body: unknown = null;
  try { body = JSON.parse(rawBody); } catch { /* leave null */ }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return jsonError(400, "validation", { issues: parsed.error.issues });

  const patch: { comment?: string | null; note?: string | null } = {};
  if ("comment" in parsed.data) patch.comment = parsed.data.comment ?? null;
  if ("note" in parsed.data) patch.note = parsed.data.note ?? null;
  if (Object.keys(patch).length === 0) {
    return jsonError(422, "validation", { message: "no updatable fields" });
  }

  let updated;
  try {
    [updated] = await db
      .update(userHighlights)
      .set(patch)
      .where(
        and(
          eq(userHighlights.id, hId),
          eq(userHighlights.userId, userId),
        ),
      )
      .returning();
  } catch (error) {
    const schemaMismatch = schemaMismatchResponseIfNeeded(error);
    if (schemaMismatch) return schemaMismatch;
    throw error;
  }
  if (!updated) return jsonError(404, "not_found");
  return Response.json({ highlight: updated });
}

export async function DELETE(req: Request, { params }: Ctx) {
  let authed;
  try { authed = await getAuthedUserId(req); }
  catch (e) {
    if (e instanceof MissingInternalSecretError) return jsonError(500, "internal auth misconfigured");
    throw e;
  }
  if (!authed) return jsonError(401, "unauthorized");
  const userId = authed.userId;
  const { highlightId } = await params;
  const hId = parseHighlightId(highlightId);
  if (hId === null) return jsonError(400, "validation", { message: "invalid highlightId" });

  let deleted;
  try {
    [deleted] = await db
      .delete(userHighlights)
      .where(
        and(
          eq(userHighlights.id, hId),
          eq(userHighlights.userId, userId),
        ),
      )
      .returning({ id: userHighlights.id });
  } catch (error) {
    const schemaMismatch = schemaMismatchResponseIfNeeded(error);
    if (schemaMismatch) return schemaMismatch;
    throw error;
  }

  if (!deleted) return jsonError(404, "not_found");
  return new Response(null, { status: 204 });
}

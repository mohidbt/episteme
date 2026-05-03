import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { userHighlights } from "@episteme/db/schema";
import { getUserIdFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/crud";

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
  const userId = await getUserIdFromRequest(req);
  if (!userId) return jsonError(401, "unauthorized");
  const { highlightId } = await params;
  const hId = parseHighlightId(highlightId);
  if (hId === null) return jsonError(400, "validation", { message: "invalid highlightId" });

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return jsonError(400, "validation", { issues: parsed.error.issues });

  const patch: { comment?: string | null; note?: string | null } = {};
  if ("comment" in parsed.data) patch.comment = parsed.data.comment ?? null;
  if ("note" in parsed.data) patch.note = parsed.data.note ?? null;
  if (Object.keys(patch).length === 0) {
    return jsonError(422, "validation", { message: "no updatable fields" });
  }

  const [updated] = await db
    .update(userHighlights)
    .set(patch)
    .where(
      and(
        eq(userHighlights.id, hId),
        eq(userHighlights.userId, userId),
      ),
    )
    .returning();
  if (!updated) return jsonError(404, "not_found");
  return Response.json({ highlight: updated });
}

export async function DELETE(req: Request, { params }: Ctx) {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return jsonError(401, "unauthorized");
  const { highlightId } = await params;
  const hId = parseHighlightId(highlightId);
  if (hId === null) return jsonError(400, "validation", { message: "invalid highlightId" });

  const [deleted] = await db
    .delete(userHighlights)
    .where(
      and(
        eq(userHighlights.id, hId),
        eq(userHighlights.userId, userId),
      ),
    )
    .returning({ id: userHighlights.id });

  if (!deleted) return jsonError(404, "not_found");
  return new Response(null, { status: 204 });
}

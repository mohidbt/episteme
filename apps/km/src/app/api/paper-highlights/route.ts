import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { paperHighlights, papers } from "@episteme/db/schema";
import { getAuthedUserId, MissingInternalSecretError } from "@/lib/internal-auth";
import { paperHighlightCreateManySchema } from "@/lib/validators";
import { jsonError, requireOwned } from "@/lib/crud";

export const runtime = "nodejs";

type PaperRow = typeof papers.$inferSelect;

export async function GET(req: Request) {
  // Dual-auth: cookie session OR HMAC. Reader UI uses cookie; agent flows
  // (and uniform internal callers) use HMAC.
  let authed;
  try { authed = await getAuthedUserId(req); }
  catch (e) {
    if (e instanceof MissingInternalSecretError) return jsonError(500, "internal auth misconfigured");
    throw e;
  }
  if (!authed) return jsonError(401, "unauthorized");
  const userId = authed.userId;
  const url = new URL(req.url);
  const paperId = url.searchParams.get("paperId");
  if (!paperId) return jsonError(400, "validation", { message: "paperId required" });

  // Verify paper ownership before returning any highlights; shape matches
  // requireOwned so that 404/403 behavior is consistent with other routes.
  const owned = await requireOwned<PaperRow>(papers, paperId, userId);
  if (!owned.ok) return jsonError(owned.status, owned.status === 404 ? "not_found" : "forbidden");

  const rows = await db
    .select()
    .from(paperHighlights)
    .where(
      and(
        eq(paperHighlights.paperId, paperId),
        eq(paperHighlights.userId, userId),
      ),
    )
    .orderBy(asc(paperHighlights.createdAt));
  return Response.json(rows);
}

export async function POST(req: Request) {
  // Dual-auth: cookie session OR HMAC (used by agent `highlight` tool).
  // Read raw body first so we can pass it to the HMAC verifier.
  const rawBody = await req.text();
  let authed;
  try { authed = await getAuthedUserId(req, rawBody); }
  catch (e) {
    if (e instanceof MissingInternalSecretError) return jsonError(500, "internal auth misconfigured");
    throw e;
  }
  if (!authed) return jsonError(401, "unauthorized");
  const userId = authed.userId;
  const body = (() => { try { return JSON.parse(rawBody); } catch { return null; } })();
  const parsed = paperHighlightCreateManySchema.safeParse(body);
  if (!parsed.success) return jsonError(400, "validation", { issues: parsed.error.issues });
  const items = Array.isArray(parsed.data) ? parsed.data : [parsed.data];
  const owned = await requireOwned<PaperRow>(papers, items[0].paperId, userId);
  if (!owned.ok) return jsonError(owned.status, owned.status === 404 ? "not_found" : "forbidden");
  if (items.some((it) => it.paperId !== items[0].paperId)) {
    return jsonError(400, "validation", { message: "all highlights must target the same paperId" });
  }
  const rows = await db
    .insert(paperHighlights)
    .values(
      items.map((it) => ({
        paperId: it.paperId,
        userId,
        page: it.page,
        bbox: (it.bbox ?? null) as typeof paperHighlights.$inferInsert["bbox"],
        runId: it.runId ?? null,
        toolCallId: it.toolCallId ?? null,
        color: it.color ?? null,
        noteMd: it.noteMd ?? null,
      })),
    )
    .returning();
  return Response.json(Array.isArray(parsed.data) ? rows : rows[0], { status: 201 });
}

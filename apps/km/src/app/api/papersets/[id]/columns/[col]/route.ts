import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { papersets } from "@episteme/db/schema";
import { getAuthedUserId, MissingInternalSecretError } from "@/lib/internal-auth";
import { jsonError, requireOwned } from "@/lib/crud";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string; col: string }> };
type PapersetRow = typeof papersets.$inferSelect;
type ColumnSpec = { name: string; description: string };
type CellGrounding = Record<string, Record<string, { paper_id: string; block_ids: string[] }>>;

const PatchBody = z.object({ description: z.string().min(1) });

function misconfiguredResponse(): Response {
  return jsonError(500, "internal auth misconfigured");
}

export async function PATCH(req: Request, { params }: Ctx) {
  const rawBody = await req.text();
  let authed;
  try { authed = await getAuthedUserId(req, rawBody); }
  catch (e) {
    if (e instanceof MissingInternalSecretError) return misconfiguredResponse();
    throw e;
  }
  if (!authed) return jsonError(401, "unauthorized");
  const userId = authed.userId;
  const { id, col } = await params;

  let body: unknown = null;
  try { body = JSON.parse(rawBody); } catch { /* leaves body=null */ }
  const parsed = PatchBody.safeParse(body);
  if (!parsed.success) return jsonError(400, "validation", { issues: parsed.error.issues });

  const owned = await requireOwned<PapersetRow>(papersets, id, userId);
  if (!owned.ok) return jsonError(owned.status, owned.status === 404 ? "not_found" : "forbidden");

  const cols = owned.row.columns as ColumnSpec[];
  const idx = cols.findIndex((c) => c.name === col);
  if (idx < 0) return jsonError(404, "column_not_found");

  const next = cols.slice();
  next[idx] = { ...next[idx], description: parsed.data.description };

  const [row] = await db
    .update(papersets)
    .set({ columns: next })
    .where(eq(papersets.id, id))
    .returning();
  return Response.json(row);
}

export async function DELETE(req: Request, { params }: Ctx) {
  let authed;
  try { authed = await getAuthedUserId(req); }
  catch (e) {
    if (e instanceof MissingInternalSecretError) return misconfiguredResponse();
    throw e;
  }
  if (!authed) return jsonError(401, "unauthorized");
  const userId = authed.userId;
  const { id, col } = await params;

  const owned = await requireOwned<PapersetRow>(papersets, id, userId);
  if (!owned.ok) return jsonError(owned.status, owned.status === 404 ? "not_found" : "forbidden");

  const cols = owned.row.columns as ColumnSpec[];
  const idx = cols.findIndex((c) => c.name === col);
  if (idx < 0) return jsonError(404, "column_not_found");
  if (cols.length <= 1) return jsonError(400, "last_column");

  const newCols = cols.filter((c) => c.name !== col);

  const grounding = owned.row.cellGrounding as CellGrounding;
  const newGrounding: CellGrounding = {};
  for (const [r, rowMap] of Object.entries(grounding)) {
    const { [col]: _drop, ...rest } = rowMap;
    if (Object.keys(rest).length > 0) newGrounding[r] = rest;
  }

  const [row] = await db
    .update(papersets)
    .set({ columns: newCols, cellGrounding: newGrounding })
    .where(eq(papersets.id, id))
    .returning();
  return Response.json(row);
}

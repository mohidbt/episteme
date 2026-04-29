import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { papers, papersets } from "@episteme/db/schema";
import { getAuthedUserId, MissingInternalSecretError } from "@/lib/internal-auth";
import { jsonError, requireOwned } from "@/lib/crud";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };
type PapersetRow = typeof papersets.$inferSelect;
type RowRef = { paper_id: string };
type CellGrounding = Record<string, Record<string, { paper_id: string; block_ids: string[] }>>;

const PostBody = z.object({
  paperIds: z.array(z.string().uuid()).min(1),
  confirmDuplicates: z.boolean().optional(),
});

function misconfiguredResponse(): Response {
  return jsonError(500, "internal auth misconfigured");
}

export async function POST(req: Request, { params }: Ctx) {
  const rawBody = await req.text();
  let authed;
  try { authed = await getAuthedUserId(req, rawBody); }
  catch (e) {
    if (e instanceof MissingInternalSecretError) return misconfiguredResponse();
    throw e;
  }
  if (!authed) return jsonError(401, "unauthorized");
  const userId = authed.userId;
  const { id } = await params;

  let body: unknown = null;
  try { body = JSON.parse(rawBody); } catch { /* leaves body=null */ }
  const parsed = PostBody.safeParse(body);
  if (!parsed.success) return jsonError(400, "validation", { issues: parsed.error.issues });

  const owned = await requireOwned<PapersetRow>(papersets, id, userId);
  if (!owned.ok) return jsonError(owned.status, owned.status === 404 ? "not_found" : "forbidden");

  const { paperIds, confirmDuplicates } = parsed.data;

  // Verify all referenced papers exist and belong to user.
  const ownedPapers = await db
    .select({ id: papers.id })
    .from(papers)
    .where(and(inArray(papers.id, paperIds), eq(papers.userId, userId)));
  const ownedSet = new Set(ownedPapers.map((p) => p.id));
  for (const pid of paperIds) {
    if (!ownedSet.has(pid)) return jsonError(403, "paper_not_owned");
  }

  const existing = new Set((owned.row.rowRefs as RowRef[]).map((r) => r.paper_id));
  if (!confirmDuplicates) {
    for (const pid of paperIds) {
      if (existing.has(pid)) return jsonError(409, "duplicate_paper");
    }
  }

  const newRefs: RowRef[] = [
    ...(owned.row.rowRefs as RowRef[]),
    ...paperIds.map((p) => ({ paper_id: p })),
  ];

  const [row] = await db
    .update(papersets)
    .set({ rowRefs: newRefs })
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
  const { id } = await params;

  const url = new URL(req.url);
  const indexStr = url.searchParams.get("index");
  if (indexStr === null) return jsonError(400, "missing_index");
  const index = Number.parseInt(indexStr, 10);
  if (!Number.isInteger(index) || index < 0) return jsonError(400, "out_of_range");

  const owned = await requireOwned<PapersetRow>(papersets, id, userId);
  if (!owned.ok) return jsonError(owned.status, owned.status === 404 ? "not_found" : "forbidden");

  const refs = owned.row.rowRefs as RowRef[];
  if (index >= refs.length) return jsonError(400, "out_of_range");

  const newRefs = [...refs.slice(0, index), ...refs.slice(index + 1)];

  // Shift cell_grounding keys: any row r > index becomes r-1; r === index is dropped.
  const grounding = owned.row.cellGrounding as CellGrounding;
  const newGrounding: CellGrounding = {};
  for (const [k, v] of Object.entries(grounding)) {
    const r = Number.parseInt(k, 10);
    if (!Number.isInteger(r)) continue;
    if (r === index) continue;
    const newKey = r > index ? String(r - 1) : k;
    newGrounding[newKey] = v;
  }

  const [row] = await db
    .update(papersets)
    .set({ rowRefs: newRefs, cellGrounding: newGrounding })
    .where(eq(papersets.id, id))
    .returning();
  return Response.json(row);
}

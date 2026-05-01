import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { papersets } from "@episteme/db/schema";
import { getAuthedUserId, MissingInternalSecretError } from "@/lib/internal-auth";
import { jsonError, requireOwned } from "@/lib/crud";
import {
  applyCellWrite,
  type CellGrounding,
  type ColumnSpec,
  type RowRef,
} from "@/lib/papersets/cell-write";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };
type PapersetRow = typeof papersets.$inferSelect;

const Body = z.object({
  row: z.number().int().nonnegative(),
  col: z.string().min(1),
  value: z.string(),
  grounding: z.object({
    paper_id: z.string().min(1),
    block_ids: z.array(z.string()),
  }),
});

function misconfiguredResponse(): Response {
  return jsonError(500, "internal auth misconfigured");
}

export async function PATCH(req: Request, { params }: Ctx) {
  const rawBody = await req.text();
  let authed;
  try {
    authed = await getAuthedUserId(req, rawBody);
  } catch (e) {
    if (e instanceof MissingInternalSecretError) return misconfiguredResponse();
    throw e;
  }
  if (!authed) return jsonError(401, "unauthorized");
  const userId = authed.userId;
  const { id } = await params;

  let body: unknown = null;
  try {
    body = JSON.parse(rawBody);
  } catch {
    /* leaves body=null */
  }
  const parsed = Body.safeParse(body);
  if (!parsed.success) return jsonError(400, "validation", { issues: parsed.error.issues });

  const owned = await requireOwned<PapersetRow>(papersets, id, userId);
  if (!owned.ok) return jsonError(owned.status, owned.status === 404 ? "not_found" : "forbidden");

  const result = applyCellWrite(
    {
      columns: owned.row.columns as ColumnSpec[],
      rowRefs: owned.row.rowRefs as RowRef[],
      content: owned.row.content,
      cellGrounding: owned.row.cellGrounding as CellGrounding,
    },
    parsed.data,
  );
  if (!result.ok) return jsonError(400, result.error);

  const [row] = await db
    .update(papersets)
    .set({
      content: result.content,
      cellGrounding: result.cellGrounding,
      updatedAt: new Date(),
    })
    .where(eq(papersets.id, id))
    .returning();
  return Response.json(row);
}

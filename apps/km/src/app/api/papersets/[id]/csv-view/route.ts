import { papersets } from "@episteme/db/schema";
import { getAuthedUserId, MissingInternalSecretError } from "@/lib/internal-auth";
import { jsonError, requireOwned } from "@/lib/crud";
import { parseCsvCells, type ColumnSpec, type RowRef } from "@/lib/papersets/cell-write";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };
type PapersetRow = typeof papersets.$inferSelect;

function misconfiguredResponse(): Response {
  return jsonError(500, "internal auth misconfigured");
}

export async function GET(req: Request, { params }: Ctx) {
  let authed;
  try {
    authed = await getAuthedUserId(req);
  } catch (e) {
    if (e instanceof MissingInternalSecretError) return misconfiguredResponse();
    throw e;
  }
  if (!authed) return jsonError(401, "unauthorized");
  const { id } = await params;

  const owned = await requireOwned<PapersetRow>(papersets, id, authed.userId);
  if (!owned.ok) return jsonError(owned.status, owned.status === 404 ? "not_found" : "forbidden");

  const columns = owned.row.columns as ColumnSpec[];
  const rowRefs = owned.row.rowRefs as RowRef[];
  const cells = parseCsvCells(owned.row.content, columns);

  return Response.json({
    file_id: id,
    columns,
    row_refs: rowRefs,
    cells,
  });
}

import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { papersets } from "@episteme/db/schema";
import { getAuthedUserId, MissingInternalSecretError } from "@/lib/internal-auth";
import { jsonError, requireOwned } from "@/lib/crud";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };
type PapersetRow = typeof papersets.$inferSelect;
type ColumnSpec = { name: string; description: string };

const PostBody = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
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

  const cols = owned.row.columns as ColumnSpec[];
  if (cols.some((c) => c.name === parsed.data.name)) return jsonError(409, "duplicate_column");

  const [row] = await db
    .update(papersets)
    .set({ columns: [...cols, parsed.data] })
    .where(eq(papersets.id, id))
    .returning();
  return Response.json(row);
}

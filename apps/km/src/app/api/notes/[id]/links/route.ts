import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { noteLinks, notes, papers, references_ } from "@episteme/db/schema";
import { getAuthedUserId, MissingInternalSecretError } from "@/lib/internal-auth";
import { noteLinkCreateSchema } from "@/lib/validators";
import { jsonError, requireOwned } from "@/lib/crud";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  let authed;
  try { authed = await getAuthedUserId(req); }
  catch (e) { if (e instanceof MissingInternalSecretError) return jsonError(500, "internal auth misconfigured"); throw e; }
  if (!authed) return jsonError(401, "unauthorized");
  const userId = authed.userId;
  const { id } = await params;
  const owner = await requireOwned<any>(notes, id, userId);
  if (!owner.ok) return jsonError(owner.status, owner.status === 404 ? "not_found" : "forbidden");
  const rows = await db
    .select()
    .from(noteLinks)
    .where(eq(noteLinks.sourceNoteId, id))
    .orderBy(asc(noteLinks.createdAt));
  return Response.json(rows);
}

export async function POST(req: Request, { params }: Ctx) {
  let authed;
  const rawBody = await req.text();
  try { authed = await getAuthedUserId(req, rawBody); }
  catch (e) { if (e instanceof MissingInternalSecretError) return jsonError(500, "internal auth misconfigured"); throw e; }
  if (!authed) return jsonError(401, "unauthorized");
  const userId = authed.userId;
  const { id } = await params;
  const owner = await requireOwned<any>(notes, id, userId);
  if (!owner.ok) return jsonError(owner.status, owner.status === 404 ? "not_found" : "forbidden");
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return jsonError(400, "validation");
  }
  const bodyWithSource = { ...(body ?? {}), sourceNoteId: id };
  const parsed = noteLinkCreateSchema.safeParse(bodyWithSource);
  if (!parsed.success) return jsonError(400, "validation", { issues: parsed.error.issues });

  // note_links is polymorphic and therefore has no target foreign key. Enforce
  // the missing tenant boundary here before accepting a resolved link.
  if (parsed.data.targetId) {
    const targetTable =
      parsed.data.targetKind === "note"
        ? notes
        : parsed.data.targetKind === "paper"
          ? papers
          : references_;
    const target = await requireOwned<any>(
      targetTable,
      parsed.data.targetId,
      userId,
    );
    if (!target.ok) return jsonError(404, "target_not_found");
  }

  const [row] = await db.insert(noteLinks).values(parsed.data).returning();
  return Response.json(row, { status: 201 });
}

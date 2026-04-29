import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { papersets } from "@episteme/db/schema";
import { getAuthedUserId, MissingInternalSecretError } from "@/lib/internal-auth";
import { jsonError, requireOwned } from "@/lib/crud";
import { moveItemToFolder, moveToTrash } from "@/lib/folders-server";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };
type PapersetRow = typeof papersets.$inferSelect;

const ColumnSpec = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
});

const PatchBody = z.object({
  filename: z
    .string()
    .min(1)
    .transform((s) => s.trim())
    .refine((s) => s.length > 0, { message: "filename empty" })
    .refine((s) => !s.includes("/") && !s.includes("\\"), {
      message: "filename must not contain path separators",
    })
    .optional(),
  folderId: z.string().uuid().nullable().optional(),
  columns: z.array(ColumnSpec).min(1).optional(),
});

function misconfiguredResponse(): Response {
  return jsonError(500, "internal auth misconfigured");
}

export async function GET(req: Request, { params }: Ctx) {
  let authed;
  try { authed = await getAuthedUserId(req); }
  catch (e) {
    if (e instanceof MissingInternalSecretError) return misconfiguredResponse();
    throw e;
  }
  if (!authed) return jsonError(401, "unauthorized");
  const { id } = await params;
  const res = await requireOwned<PapersetRow>(papersets, id, authed.userId);
  if (!res.ok) return jsonError(res.status, res.status === 404 ? "not_found" : "forbidden");
  return Response.json(res.row);
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
  const { id } = await params;

  let body: unknown = null;
  try { body = JSON.parse(rawBody); } catch { /* leaves body=null */ }
  const parsed = PatchBody.safeParse(body);
  if (!parsed.success) return jsonError(400, "validation", { issues: parsed.error.issues });

  const res = await requireOwned<PapersetRow>(papersets, id, userId);
  if (!res.ok) return jsonError(res.status, res.status === 404 ? "not_found" : "forbidden");

  const { folderId, filename, columns } = parsed.data;

  if (folderId !== undefined) {
    try {
      await moveItemToFolder({ kind: "paperset", itemId: id, userId, targetFolderId: folderId });
    } catch (err) {
      const status = (err as { status?: number }).status ?? 500;
      if (status === 404) return jsonError(404, "folder_not_found");
      throw err;
    }
  }

  const updates: Record<string, unknown> = {};
  if (filename !== undefined) {
    updates.filename = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  }
  if (columns !== undefined) updates.columns = columns;

  if (Object.keys(updates).length > 0) {
    const [row] = await db.update(papersets).set(updates).where(eq(papersets.id, id)).returning();
    return Response.json(row);
  }
  const [row] = await db.select().from(papersets).where(eq(papersets.id, id));
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

  const res = await requireOwned<PapersetRow>(papersets, id, userId);
  if (!res.ok) return jsonError(res.status, res.status === 404 ? "not_found" : "forbidden");

  await moveToTrash({
    libraryId: res.row.libraryId,
    userId,
    target: { kind: "paperset", id },
  });
  return new Response(null, { status: 204 });
}

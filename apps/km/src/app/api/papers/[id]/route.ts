import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { papers } from "@episteme/db/schema";
import { getUserIdFromRequest } from "@/lib/auth";
import { paperUpdateSchema } from "@/lib/validators";
import { jsonError, requireOwned } from "@/lib/crud";
import { moveItemToFolder } from "@/lib/folders-server";
import { storage, paperSourceKey, paperCoverKey } from "@/lib/storage";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };
type PaperRow = typeof papers.$inferSelect;

export async function GET(req: Request, { params }: Ctx) {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return jsonError(401, "unauthorized");
  const { id } = await params;
  const res = await requireOwned<PaperRow>(papers, id, userId);
  if (!res.ok) return jsonError(res.status, res.status === 404 ? "not_found" : "forbidden");
  return Response.json(res.row);
}

export async function PATCH(req: Request, { params }: Ctx) {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return jsonError(401, "unauthorized");
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = paperUpdateSchema.safeParse(body);
  if (!parsed.success) return jsonError(400, "validation", { issues: parsed.error.issues });
  const res = await requireOwned<PaperRow>(papers, id, userId);
  if (!res.ok) return jsonError(res.status, res.status === 404 ? "not_found" : "forbidden");
  const { folderId, ...rest } = parsed.data;
  if (folderId !== undefined) {
    if (rest.folderPath !== undefined) {
      console.warn("papers PATCH: folderPath ignored when folderId is present");
    }
    try {
      await moveItemToFolder({ kind: "paper", itemId: id, userId, targetFolderId: folderId });
    } catch (err) {
      const status = (err as { status?: number }).status ?? 500;
      if (status === 404) return jsonError(404, "folder_not_found");
      throw err;
    }
  }
  const hasOtherUpdates = Object.keys(rest).length > 0;
  if (hasOtherUpdates) {
    const [row] = await db.update(papers).set(rest).where(eq(papers.id, id)).returning();
    return Response.json(row);
  }
  const [row] = await db.select().from(papers).where(eq(papers.id, id));
  return Response.json(row);
}

export async function DELETE(req: Request, { params }: Ctx) {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return jsonError(401, "unauthorized");
  const { id } = await params;
  const res = await requireOwned<PaperRow>(papers, id, userId);
  if (!res.ok) return jsonError(res.status, res.status === 404 ? "not_found" : "forbidden");

  // DB delete first — paper_highlights + paper_embeddings cascade via FK.
  await db.delete(papers).where(eq(papers.id, id));

  // Best-effort storage cleanup. If this fails we've still deleted the DB row
  // (user's intent succeeded); stale blobs become a janitor job rather than
  // a user-visible error. TODO: structured logging.
  await storage.deleteObject(paperSourceKey(id)).catch(() => {});
  await storage.deleteObject(paperCoverKey(id)).catch(() => {});

  return new Response(null, { status: 204 });
}

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { assets, folders } from "@episteme/db/schema";
import { getUserIdFromRequest } from "@/lib/auth";
import { getAuthedUserId, MissingInternalSecretError } from "@/lib/internal-auth";
import { assetUpdateSchema } from "@/lib/validators";
import { jsonError, requireOwned } from "@/lib/crud";
import { storage, assetSourceKey } from "@/lib/storage";

export const runtime = "nodejs";

const DOWNLOAD_TTL_SEC = 600;

type Ctx = { params: Promise<{ id: string }> };
type AssetRow = typeof assets.$inferSelect;

// GSD-41 — agent sidecar fetches asset metadata via HMAC; cookie-only auth
// would 401 every agent call (see memory feedback_agent_dual_auth). Dual-auth
// here keeps existing cookie session callers working.
export async function GET(req: Request, { params }: Ctx) {
  let authed;
  try { authed = await getAuthedUserId(req); }
  catch (e) {
    if (e instanceof MissingInternalSecretError) return jsonError(500, "internal_auth_misconfigured");
    throw e;
  }
  if (!authed) return jsonError(401, "unauthorized");
  const userId = authed.userId;
  const { id } = await params;
  const res = await requireOwned<AssetRow>(assets, id, userId);
  if (!res.ok) return jsonError(res.status, res.status === 404 ? "not_found" : "forbidden");
  const downloadUrl = await storage.getPresignedGet(
    assetSourceKey(res.row.id),
    DOWNLOAD_TTL_SEC,
  );
  return Response.json({ ...res.row, downloadUrl });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return jsonError(401, "unauthorized");
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = assetUpdateSchema.safeParse(body);
  if (!parsed.success) return jsonError(400, "validation", { issues: parsed.error.issues });
  const res = await requireOwned<AssetRow>(assets, id, userId);
  if (!res.ok) return jsonError(res.status, res.status === 404 ? "not_found" : "forbidden");

  const { folderId, filename } = parsed.data;
  const updates: Partial<typeof assets.$inferInsert> = {};

  if (folderId !== undefined) {
    if (folderId !== null) {
      const [f] = await db
        .select({ libraryId: folders.libraryId, userId: folders.userId })
        .from(folders)
        .where(eq(folders.id, folderId))
        .limit(1);
      if (!f || f.libraryId !== res.row.libraryId || f.userId !== userId) {
        return jsonError(404, "folder_not_found");
      }
    }
    updates.folderId = folderId;
  }
  if (filename !== undefined) updates.filename = filename;

  if (Object.keys(updates).length > 0) {
    const [row] = await db
      .update(assets)
      .set(updates)
      .where(and(eq(assets.id, id), eq(assets.userId, userId)))
      .returning();
    return Response.json(row);
  }
  return Response.json(res.row);
}

export async function DELETE(req: Request, { params }: Ctx) {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return jsonError(401, "unauthorized");
  const { id } = await params;
  const res = await requireOwned<AssetRow>(assets, id, userId);
  if (!res.ok) return jsonError(res.status, res.status === 404 ? "not_found" : "forbidden");

  // Mirror papers DELETE: drop DB row first (user intent), then best-effort
  // S3 cleanup. A failed S3 delete becomes a janitor problem, not a UX error.
  await db.delete(assets).where(eq(assets.id, id));
  await storage.deleteObject(assetSourceKey(id)).catch(() => {});

  return new Response(null, { status: 204 });
}

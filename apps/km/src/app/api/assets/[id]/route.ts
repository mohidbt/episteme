import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { assets } from "@episteme/db/schema";
import { getUserIdFromRequest } from "@/lib/auth";
import { jsonError, requireOwned } from "@/lib/crud";
import { storage, assetSourceKey } from "@/lib/storage";

export const runtime = "nodejs";

const DOWNLOAD_TTL_SEC = 600;

type Ctx = { params: Promise<{ id: string }> };
type AssetRow = typeof assets.$inferSelect;

export async function GET(req: Request, { params }: Ctx) {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return jsonError(401, "unauthorized");
  const { id } = await params;
  const res = await requireOwned<AssetRow>(assets, id, userId);
  if (!res.ok) return jsonError(res.status, res.status === 404 ? "not_found" : "forbidden");
  const downloadUrl = await storage.getPresignedGet(
    assetSourceKey(res.row.id),
    DOWNLOAD_TTL_SEC,
  );
  return Response.json({ ...res.row, downloadUrl });
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

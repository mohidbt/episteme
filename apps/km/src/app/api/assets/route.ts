import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { assets, libraries } from "@episteme/db/schema";
import { getUserIdFromRequest } from "@/lib/auth";
import { assetUploadInitSchema } from "@/lib/validators";
import { jsonError, requireOwned } from "@/lib/crud";
import { storage, assetSourceKey } from "@/lib/storage";
import { sanitizeFilename } from "@/lib/filename";
import { assertWithinLibraryLimit } from "@/lib/library-usage";

export const runtime = "nodejs";

const UPLOAD_TTL_SEC = 600;

export async function GET(req: Request) {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return jsonError(401, "unauthorized");
  const url = new URL(req.url);
  const libraryIdStr = url.searchParams.get("libraryId");
  if (!libraryIdStr) return jsonError(400, "validation", { message: "libraryId required" });
  const libraryId = Number(libraryIdStr);
  if (!Number.isFinite(libraryId)) return jsonError(400, "validation");
  const folderIdParam = url.searchParams.get("folderId");
  const conds = [eq(assets.userId, userId), eq(assets.libraryId, libraryId)];
  if (folderIdParam !== null) {
    if (folderIdParam === "" || folderIdParam === "null") {
      conds.push(isNull(assets.folderId));
    } else {
      conds.push(eq(assets.folderId, folderIdParam));
    }
  }
  const rows = await db
    .select()
    .from(assets)
    .where(and(...conds))
    .orderBy(desc(assets.createdAt));
  return Response.json(rows);
}

export async function POST(req: Request) {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return jsonError(401, "unauthorized");
  const body = await req.json().catch(() => null);
  const parsed = assetUploadInitSchema.safeParse(body);
  if (!parsed.success) return jsonError(400, "validation", { issues: parsed.error.issues });
  const lib = await requireOwned<any>(libraries, parsed.data.libraryId, userId);
  if (!lib.ok) return jsonError(lib.status, lib.status === 404 ? "not_found" : "forbidden");

  const cap = await assertWithinLibraryLimit(parsed.data.libraryId, parsed.data.sizeBytes);
  if (!cap.ok) {
    return jsonError(413, "over_limit", {
      usedBytes: cap.usedBytes,
      limitBytes: cap.limitBytes,
    });
  }

  const cleanFilename = sanitizeFilename(parsed.data.filename);

  const [row] = await db
    .insert(assets)
    .values({
      libraryId: parsed.data.libraryId,
      userId,
      folderId: parsed.data.folderId ?? null,
      filename: cleanFilename,
      mimeType: parsed.data.contentType,
      sizeBytes: parsed.data.sizeBytes,
    })
    .returning();

  const uploadUrl = await storage.getPresignedPut(
    assetSourceKey(row.id),
    parsed.data.contentType,
    UPLOAD_TTL_SEC,
  );

  return Response.json({ assetId: row.id, uploadUrl }, { status: 201 });
}

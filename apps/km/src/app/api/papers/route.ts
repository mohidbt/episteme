import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { papers, libraries } from "@episteme/db/schema";
import { getUserIdFromRequest } from "@/lib/auth";
import { paperUploadInitSchema } from "@/lib/validators";
import { jsonError, requireOwned } from "@/lib/crud";
import { storage, paperSourceKey } from "@/lib/storage";
import { filenameToTitle, sanitizeFilename } from "@/lib/pdf-extract";

// pdfjs-dist + @napi-rs/canvas need the Node runtime; finalize imports them
// transitively via pdf-extract. Pin here so dev and prod agree.
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
  const folderPath = url.searchParams.get("folderPath");
  const conds = [eq(papers.userId, userId), eq(papers.libraryId, libraryId)];
  if (folderPath !== null) conds.push(eq(papers.folderPath, folderPath));
  const rows = await db
    .select()
    .from(papers)
    .where(and(...conds))
    .orderBy(desc(papers.addedAt));
  return Response.json(rows);
}

export async function POST(req: Request) {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return jsonError(401, "unauthorized");
  const body = await req.json().catch(() => null);
  const parsed = paperUploadInitSchema.safeParse(body);
  if (!parsed.success) return jsonError(400, "validation", { issues: parsed.error.issues });
  const lib = await requireOwned<any>(libraries, parsed.data.libraryId, userId);
  if (!lib.ok) return jsonError(lib.status, lib.status === 404 ? "not_found" : "forbidden");

  const cleanFilename = sanitizeFilename(parsed.data.filename);
  const placeholderTitle = filenameToTitle(parsed.data.filename);

  const [row] = await db
    .insert(papers)
    .values({
      libraryId: parsed.data.libraryId,
      userId,
      folderPath: parsed.data.folderPath,
      filename: cleanFilename,
      title: placeholderTitle,
    })
    .returning();

  const uploadUrl = await storage.getPresignedPut(
    paperSourceKey(row.id),
    parsed.data.contentType,
    UPLOAD_TTL_SEC,
  );

  return Response.json({ paperId: row.id, uploadUrl }, { status: 201 });
}

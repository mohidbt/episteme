import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { papers, libraries } from "@episteme/db/schema";
import { getAuthedUserId, MissingInternalSecretError } from "@/lib/internal-auth";
import { paperUploadInitSchema } from "@/lib/validators";
import { jsonError, requireOwned } from "@/lib/crud";
import { storage, paperSourceKey } from "@/lib/storage";
import { filenameToTitle, sanitizeFilename } from "@/lib/filename";
import { assertWithinLibraryLimit } from "@/lib/library-usage";

export const runtime = "nodejs";

const UPLOAD_TTL_SEC = 600;

export async function GET(req: Request) {
  // Dual-auth: cookie session OR HMAC (for agent tools like list_pdfs).
  let authed;
  try { authed = await getAuthedUserId(req); }
  catch (e) {
    if (e instanceof MissingInternalSecretError) return jsonError(500, "internal auth misconfigured");
    throw e;
  }
  if (!authed) return jsonError(401, "unauthorized");
  const userId = authed.userId;
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
  // Dual-auth: cookie session OR HMAC (for agent tools like agentic_fetch_papers).
  // Read raw body first so the HMAC verifier can sign over it.
  const rawBody = await req.text();
  let authed;
  try { authed = await getAuthedUserId(req, rawBody); }
  catch (e) {
    if (e instanceof MissingInternalSecretError) return jsonError(500, "internal auth misconfigured");
    throw e;
  }
  if (!authed) return jsonError(401, "unauthorized");
  const userId = authed.userId;
  const body = (() => { try { return JSON.parse(rawBody); } catch { return null; } })();
  const parsed = paperUploadInitSchema.safeParse(body);
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
  const placeholderTitle = filenameToTitle(parsed.data.filename);

  const [row] = await db
    .insert(papers)
    .values({
      libraryId: parsed.data.libraryId,
      userId,
      folderPath: parsed.data.folderPath,
      folderId: parsed.data.folderId ?? null,
      filename: cleanFilename,
      title: placeholderTitle,
      sizeBytes: parsed.data.sizeBytes,
    })
    .returning();

  const uploadUrl = await storage.getPresignedPut(
    paperSourceKey(row.id),
    parsed.data.contentType,
    UPLOAD_TTL_SEC,
  );

  return Response.json({ paperId: row.id, uploadUrl }, { status: 201 });
}

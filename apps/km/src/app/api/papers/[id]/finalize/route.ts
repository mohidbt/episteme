import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { papers } from "@episteme/db/schema";
import { getAuthedUserId, MissingInternalSecretError } from "@/lib/internal-auth";
import { jsonError, requireOwned } from "@/lib/crud";
import { storage, paperSourceKey, paperCoverKey } from "@/lib/storage";
import {
  extractCover,
  extractMetadata,
  filenameToTitle,
  type PaperMetadata,
} from "@/lib/pdf-extract";

// pdfjs-dist + @napi-rs/canvas require the Node.js runtime.
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

type PaperRow = typeof papers.$inferSelect;

const MAX_PDF_BYTES = 50 * 1024 * 1024;

export async function POST(req: Request, { params }: Ctx) {
  // Dual-auth: cookie session OR HMAC (agentic_fetch_papers calls this after
  // upload). Pass rawBody so HMAC verifier signs over what the caller signed.
  const rawBody = await req.text();
  let authed;
  try { authed = await getAuthedUserId(req, rawBody); }
  catch (e) {
    if (e instanceof MissingInternalSecretError) return jsonError(500, "internal auth misconfigured");
    throw e;
  }
  if (!authed) return jsonError(401, "unauthorized");
  const userId = authed.userId;
  const { id } = await params;

  const res = await requireOwned<PaperRow>(papers, id, userId);
  if (!res.ok) return jsonError(res.status, res.status === 404 ? "not_found" : "forbidden");
  const row = res.row;

  const sourceKey = paperSourceKey(id);

  // HEAD first so we can reject oversized PDFs without buffering them.
  const headUrl = await storage.getPresignedHead(sourceKey, 120);
  const headRes = await fetch(headUrl, { method: "HEAD" });
  if (headRes.status === 404) {
    return jsonError(422, "source_missing");
  }
  if (!headRes.ok) {
    return jsonError(502, "source_fetch_failed", { status: headRes.status });
  }
  const lenStr = headRes.headers.get("content-length");
  const len = lenStr ? Number(lenStr) : NaN;
  if (Number.isFinite(len) && len > MAX_PDF_BYTES) {
    return jsonError(413, "payload_too_large");
  }
  // Capture the real Content-Length so finalize can overwrite the
  // client-claimed sizeBytes — defense-in-depth against forged init payloads
  // and the source of zero-byte legacy rows that the backfill route handles.
  const actualSizeBytes = Number.isFinite(len) && len > 0 ? len : null;

  const getUrl = await storage.getPresignedGet(sourceKey, 120);
  const sourceRes = await fetch(getUrl);
  // Belt-and-suspenders: object could have been deleted between HEAD and GET.
  if (sourceRes.status === 404) {
    return jsonError(422, "source_missing");
  }
  if (!sourceRes.ok) {
    return jsonError(502, "source_fetch_failed", { status: sourceRes.status });
  }
  const bytes = new Uint8Array(await sourceRes.arrayBuffer());

  let meta: PaperMetadata;
  try {
    meta = await extractMetadata(bytes, row.filename);
  } catch {
    return jsonError(502, "extraction_failed");
  }

  // Cover failure must NOT fail finalize — log and skip.
  try {
    const cover = await extractCover(bytes);
    await storage.uploadObject(paperCoverKey(id), cover, "image/png");
  } catch (err) {
    console.warn(`finalize: cover extraction failed for paper ${id}`, err);
  }

  const placeholder = filenameToTitle(row.filename);
  const metaTitle = meta.title && meta.title.length > 0 ? meta.title : null;
  const metaYear = typeof meta.year === "number" ? meta.year : null;
  const metaDoi = typeof meta.doi === "string" ? meta.doi : null;

  // Drizzle's sql-tag inlines a JS array as a record literal "(a, b, c)",
  // which pg refuses to cast to text[]. Emit an explicit ARRAY[...] literal
  // — or NULL when empty — so the CASE arm is well-typed.
  const metaAuthorsSql =
    meta.authors.length > 0
      ? sql`ARRAY[${sql.join(meta.authors.map((a) => sql`${a}`), sql`, `)}]::text[]`
      : sql`NULL::text[]`;

  // Note: if a user manually set title to exactly the placeholder
  // (filenameToTitle(filename)), re-finalize will overwrite it. A future
  // "titleUserEdited" column would fix this; acceptable edge case for now.
  //
  // Running the idempotency checks inside a single UPDATE (via CASE) makes
  // concurrent finalize calls safe: no second call can clobber a title the
  // first call — or the user — just wrote.
  const [updated] = await db
    .update(papers)
    .set({
      title: sql<string>`CASE WHEN ${papers.title} = ${placeholder} AND ${metaTitle}::text IS NOT NULL THEN ${metaTitle}::text ELSE ${papers.title} END`,
      authors: sql<
        string[] | null
      >`CASE WHEN (${papers.authors} IS NULL OR cardinality(${papers.authors}) = 0) AND ${metaAuthorsSql} IS NOT NULL THEN ${metaAuthorsSql} ELSE ${papers.authors} END`,
      year: sql<
        number | null
      >`CASE WHEN ${papers.year} IS NULL THEN ${metaYear}::integer ELSE ${papers.year} END`,
      doi: sql<
        string | null
      >`CASE WHEN ${papers.doi} IS NULL THEN ${metaDoi}::text ELSE ${papers.doi} END`,
      storageUrl: sourceKey,
      ...(actualSizeBytes !== null ? { sizeBytes: actualSizeBytes } : {}),
    })
    .where(eq(papers.id, id))
    .returning();

  return Response.json(updated);
}

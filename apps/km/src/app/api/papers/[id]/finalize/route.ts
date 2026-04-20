import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { papers } from "@episteme/db/schema";
import { getUserIdFromRequest } from "@/lib/auth";
import { jsonError, requireOwned } from "@/lib/crud";
import {
  storage,
  paperSourceKey,
  paperCoverKey,
  S3_BUCKET,
} from "@/lib/storage";
import {
  extractCover,
  extractMetadata,
  filenameToTitle,
} from "@/lib/pdf-extract";

// pdfjs-dist + @napi-rs/canvas require the Node.js runtime.
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

type PaperRow = typeof papers.$inferSelect;

export async function POST(req: Request, { params }: Ctx) {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return jsonError(401, "unauthorized");
  const { id } = await params;

  const res = await requireOwned<PaperRow>(papers, id, userId);
  if (!res.ok) return jsonError(res.status, res.status === 404 ? "not_found" : "forbidden");
  const row = res.row;

  const sourceKey = paperSourceKey(id);
  const getUrl = await storage.getPresignedGet(sourceKey, 120);
  const sourceRes = await fetch(getUrl);
  if (sourceRes.status === 404) {
    return jsonError(422, "source_missing");
  }
  if (!sourceRes.ok) {
    return jsonError(502, "source_fetch_failed", { status: sourceRes.status });
  }
  const bytes = new Uint8Array(await sourceRes.arrayBuffer());

  const meta = await extractMetadata(bytes, row.filename);

  // Cover failure must NOT fail finalize — log and skip.
  try {
    const cover = await extractCover(bytes);
    await storage.uploadObject(paperCoverKey(id), cover, "image/png");
  } catch (err) {
    console.warn(`finalize: cover extraction failed for paper ${id}`, err);
  }

  const placeholderTitle = filenameToTitle(row.filename);
  const patch: Partial<PaperRow> = {
    storageUrl: `s3://${S3_BUCKET}/${sourceKey}`,
  };

  // Idempotent: only overwrite fields that still hold the placeholder/empty.
  if (row.title === placeholderTitle && meta.title) {
    patch.title = meta.title;
  }
  if ((row.authors === null || row.authors.length === 0) && meta.authors.length > 0) {
    patch.authors = meta.authors;
  }
  if (row.year === null && typeof meta.year === "number") {
    patch.year = meta.year;
  }
  if (row.doi === null && typeof meta.doi === "string") {
    patch.doi = meta.doi;
  }

  const [updated] = await db
    .update(papers)
    .set(patch)
    .where(eq(papers.id, id))
    .returning();

  return Response.json(updated);
}

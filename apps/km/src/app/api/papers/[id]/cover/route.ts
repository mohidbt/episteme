import { papers } from "@episteme/db/schema";
import { getUserIdFromRequest } from "@/lib/auth";
import { jsonError, requireOwned } from "@/lib/crud";
import { storage, paperCoverKey } from "@/lib/storage";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };
type PaperRow = typeof papers.$inferSelect;

const PRESIGN_TTL_SEC = 120;

export async function GET(req: Request, { params }: Ctx) {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return jsonError(401, "unauthorized");
  const { id } = await params;
  const res = await requireOwned<PaperRow>(papers, id, userId);
  if (!res.ok) return jsonError(res.status, res.status === 404 ? "not_found" : "forbidden");
  // Cover may legitimately be missing (extraction failed silently during seed
  // or finalize) — surface that as 404 so the client can render its
  // placeholder instead of a broken <img>. Storage misconfiguration (e.g. S3
  // env vars unset in deploy) also lands here; logged loudly so deploy
  // breakage is diagnosable.
  let url: string;
  try {
    url = await storage.getPresignedGet(paperCoverKey(id), PRESIGN_TTL_SEC);
  } catch (err) {
    console.error(
      `cover: presign failed for paper ${id} (storage endpoint=${process.env.S3_ENDPOINT ?? "<unset>"} bucket=${process.env.S3_BUCKET ?? "<unset>"})`,
      err,
    );
    return jsonError(404, "cover_unavailable");
  }
  return new Response(null, {
    status: 302,
    headers: { location: url, "cache-control": "private, no-store" },
  });
}

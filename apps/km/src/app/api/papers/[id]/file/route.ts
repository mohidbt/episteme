import { papers } from "@episteme/db/schema";
import { getUserIdFromRequest } from "@/lib/auth";
import { jsonError, requireOwned } from "@/lib/crud";
import { storage, paperSourceKey } from "@/lib/storage";

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
  const url = await storage.getPresignedGet(paperSourceKey(id), PRESIGN_TTL_SEC);
  const upstreamHeaders = new Headers();
  const range = req.headers.get("range");
  if (range) upstreamHeaders.set("range", range);
  const ifRange = req.headers.get("if-range");
  if (ifRange) upstreamHeaders.set("if-range", ifRange);
  const ifNoneMatch = req.headers.get("if-none-match");
  if (ifNoneMatch) upstreamHeaders.set("if-none-match", ifNoneMatch);
  const ifModifiedSince = req.headers.get("if-modified-since");
  if (ifModifiedSince) upstreamHeaders.set("if-modified-since", ifModifiedSince);

  const upstream = await fetch(url, {
    cache: "no-store",
    headers: upstreamHeaders,
  });
  if (!upstream.ok || !upstream.body) {
    return jsonError(502, "storage_unavailable");
  }

  const headers = new Headers();
  const contentType = upstream.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  const contentLength = upstream.headers.get("content-length");
  if (contentLength) headers.set("content-length", contentLength);
  const acceptRanges = upstream.headers.get("accept-ranges");
  if (acceptRanges) headers.set("accept-ranges", acceptRanges);
  headers.set("cache-control", "private, no-store");

  const contentRange = upstream.headers.get("content-range");
  if (contentRange) headers.set("content-range", contentRange);
  const etag = upstream.headers.get("etag");
  if (etag) headers.set("etag", etag);
  const lastModified = upstream.headers.get("last-modified");
  if (lastModified) headers.set("last-modified", lastModified);

  return new Response(upstream.body, { status: upstream.status, headers });
}

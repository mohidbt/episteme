import type { CslItem } from "@/lib/csl";
import { fetchCrossRef } from "@/lib/crossref";

export const runtime = "nodejs";

const cache = new Map<string, { csl: CslItem; expiresAt: number }>();
const TTL_MS = 60 * 60 * 1000; // 1 hour

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ doi: string }> },
) {
  const { doi: rawDoi } = await ctx.params;
  const doi = decodeURIComponent(rawDoi);

  const cached = cache.get(doi);
  if (cached && cached.expiresAt > Date.now()) {
    return Response.json(cached.csl);
  }

  const csl = await fetchCrossRef(doi);
  if (csl === null) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  cache.set(doi, { csl, expiresAt: Date.now() + TTL_MS });
  return Response.json(csl);
}

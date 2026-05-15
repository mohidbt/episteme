import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { openrouterCatalog } from "@episteme/db/schema";

// Public endpoint — OpenRouter model catalog is public data, served from a
// 24h-TTL cache populated by the Python agents service.
//
// Self-healing: if the table is empty or the oldest row is past TTL, we
// fire-and-forget a refresh to the agents service. The current response
// still serves whatever we have (stale-while-revalidate). Endpoint requires
// no auth on the agents side — it just upserts public OpenRouter data.
const TTL_MS = 24 * 60 * 60 * 1000;

export async function GET() {
  const rows = await db
    .select({
      payload: openrouterCatalog.payload,
      fetchedAt: openrouterCatalog.fetchedAt,
    })
    .from(openrouterCatalog)
    .orderBy(desc(openrouterCatalog.fetchedAt));

  const fetchedAt =
    rows.length > 0 ? rows[0].fetchedAt.toISOString() : null;
  const models = rows.map((r) => r.payload);

  // Last row is oldest (DESC sort). Stale when empty or oldest > TTL.
  const oldest = rows.length > 0 ? rows[rows.length - 1].fetchedAt : null;
  const stale =
    rows.length === 0 ||
    (oldest !== null && Date.now() - oldest.getTime() > TTL_MS);

  if (stale) {
    const agentsUrl = process.env.AGENTS_URL;
    if (agentsUrl) {
      // Fire-and-forget — do NOT await. Failures are swallowed; next request
      // will retry. The agents service de-dupes concurrent refreshes via a
      // module-level in-flight flag.
      void fetch(`${agentsUrl}/openrouter/catalog/refresh`, {
        method: "POST",
      }).catch(() => {});
    }
  }

  return Response.json({ models, fetched_at: fetchedAt, stale });
}

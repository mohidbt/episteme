import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { openrouterCatalog } from "@episteme/db/schema";

// Public endpoint — OpenRouter model catalog is public data, served from a
// 24h-TTL cache populated by the Python agents service.
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

  return Response.json({ models, fetched_at: fetchedAt });
}

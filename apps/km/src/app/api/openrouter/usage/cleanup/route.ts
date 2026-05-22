import { and, eq } from "drizzle-orm";
import { getSessionInfo } from "@/lib/auth";
import { db } from "@/lib/db";
import { openrouterUsage } from "@episteme/db/schema";

export const runtime = "nodejs";

// One-shot self-scoped scrub: deletes the user's `openrouter_usage` rows
// where the model id looks doubled (e.g. "openai/Xopenai/X"). Cause: an
// early version of the km-invoke instrumentation pulled the model id from
// LangChain's `response_metadata.model_name`, which accumulates across
// streamed chunks — fixed in 7360d20.
//
// Doubling pattern: `<prefix><prefix>` where prefix contains a `/`.
// Filter is intentionally narrow: it requires the literal substring
// `openai/`...`openai/` (or any provider prefix) twice. Real model ids
// never contain the provider segment twice.
export async function POST(req: Request) {
  const session = await getSessionInfo(req);
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const userId = session.userId;

  // Identify candidates via SUBSTRING(model, 1, len/2) = SUBSTRING(model, len/2 + 1).
  // Implementing that in raw SQL is overkill for a one-off; instead, pull
  // the user's rows once and filter in JS, then delete by ID list.
  const rows = await db
    .select({ id: openrouterUsage.id, model: openrouterUsage.model })
    .from(openrouterUsage)
    .where(eq(openrouterUsage.userId, userId));

  // Narrow predicate: require provider/slug shape and that the FIRST half
  // already contains a '/'. Stops a legitimate even-length palindrome-like
  // model id (e.g. "abab") from being deleted.
  const doubled = rows.filter((r) => {
    const m = r.model;
    if (!m || m.length < 6 || m.length % 2 !== 0) return false;
    const half = m.length / 2;
    if (!m.slice(0, half).includes("/")) return false;
    return m.slice(0, half) === m.slice(half);
  });

  if (doubled.length === 0) {
    return Response.json({ scanned: rows.length, deleted: 0 });
  }

  let deleted = 0;
  for (const r of doubled) {
    const res = await db
      .delete(openrouterUsage)
      .where(
        and(eq(openrouterUsage.id, r.id), eq(openrouterUsage.userId, userId)),
      )
      .returning({ id: openrouterUsage.id });
    deleted += res.length;
  }

  return Response.json({
    scanned: rows.length,
    deleted,
    samples: doubled.slice(0, 3).map((r) => r.model),
  });
}


import { NextRequest, NextResponse } from "next/server";
import { auth } from "@episteme/auth/server";
import { db } from "@/lib/db";
import { aiHighlightRuns, papers } from "@episteme/db/schema";
import { and, eq } from "drizzle-orm";
import { getOrApiKey } from "@/lib/openrouter-key";
import { jsonError, requireOwned } from "@/lib/crud";
import { signRequest } from "@/lib/agents/sign-request";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Ctx = { params: Promise<{ id: string; runId: string }> };
type PaperRow = typeof papers.$inferSelect;

// Rebuild a legacy AI highlight run's rects in place. Proxies to the Python
// agents service which re-runs pdfplumber glyph extraction. User-scoped:
// only the paper owner may rebuild.
export async function POST(request: NextRequest, { params }: Ctx) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return jsonError(401, "unauthorized");

  const { id: paperId, runId } = await params;
  if (!UUID_RE.test(runId)) return jsonError(400, "invalid_id");

  const owned = await requireOwned<PaperRow>(papers, paperId, session.user.id);
  if (!owned.ok) return jsonError(owned.status, owned.status === 404 ? "not_found" : "forbidden");

  const [run] = await db
    .select({ id: aiHighlightRuns.id })
    .from(aiHighlightRuns)
    .where(
      and(
        eq(aiHighlightRuns.id, runId),
        eq(aiHighlightRuns.paperId, paperId),
        eq(aiHighlightRuns.userId, session.user.id),
      ),
    )
    .limit(1);
  if (!run) return jsonError(404, "not_found");

  // GSD-132: swap to managed-bucket resolver for audit consistency. Rebuild
  // doesn't actually hit the LLM — the signed-request envelope just needs a
  // key slot — so we keep the legacy "swallow on failure, send empty key"
  // semantics. Any thrown error (Missing or TrialExhausted) → "".
  const isAnon = Boolean(
    (session.user as { isAnonymous?: boolean }).isAnonymous,
  );
  let llmKey: string;
  try {
    llmKey = await getOrApiKey(isAnon ? null : session.user.id);
  } catch {
    llmKey = "";
  }

  const path = `/agents/auto-highlight/runs/${runId}/rebuild`;
  const body = "";
  const { headers } = signRequest({
    method: "POST",
    path,
    body,
    userId: session.user.id,
    paperId,
    llmKey,
  });

  const upstream = await fetch(`${process.env.AGENTS_URL}${path}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body,
  });
  const text = await upstream.text();
  return new NextResponse(text, {
    status: upstream.status,
    headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" },
  });
}

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@episteme/auth/server";
import { db } from "@episteme/db";
import { aiHighlightRuns, documents } from "@episteme/db/schema";
import { and, eq } from "drizzle-orm";
import { getDecryptedApiKey } from "@episteme/auth/byok";
import { signRequest } from "@/lib/agents/sign-request";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Rebuild a legacy AI highlight run's rects in place. Proxies to the Python
// agents service which re-runs pdfplumber glyph extraction. User-scoped:
// only the document owner may rebuild.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; runId: string }> }
) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, runId } = await params;
  const documentId = parseInt(id, 10);
  if (isNaN(documentId) || !UUID_RE.test(runId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const [doc] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.userId, session.user.id)))
    .limit(1);
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [run] = await db
    .select({ id: aiHighlightRuns.id })
    .from(aiHighlightRuns)
    .where(
      and(
        eq(aiHighlightRuns.id, runId),
        eq(aiHighlightRuns.documentId, documentId),
        eq(aiHighlightRuns.userId, session.user.id)
      )
    )
    .limit(1);
  if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let llmKey: string;
  try {
    llmKey = await getDecryptedApiKey(session.user.id);
  } catch {
    // Rebuild doesn't hit the LLM, but the signed-request envelope requires a
    // key slot. Empty string keeps the signature valid and the Python side
    // never reads it for this route.
    llmKey = "";
  }

  const path = `/agents/auto-highlight/runs/${runId}/rebuild`;
  const body = "";
  const { headers } = signRequest({
    method: "POST",
    path,
    body,
    userId: session.user.id,
    documentId,
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

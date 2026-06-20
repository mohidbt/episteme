import { NextRequest } from "next/server";
import { auth } from "@episteme/auth/server";
import {
  getOrApiKey,
  OpenRouterKeyMissing,
  OpenRouterTrialExhausted,
} from "@/lib/openrouter-key";
import { papers } from "@episteme/db/schema";
import { jsonError, requireOwned } from "@/lib/crud";
import { signRequest } from "@/lib/agents/sign-request";
import { streamPassthrough } from "@/lib/agents/stream-passthrough";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };
type PaperRow = typeof papers.$inferSelect;

export async function POST(request: NextRequest, { params }: Ctx) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return jsonError(401, "unauthorized");
  const { id: paperId } = await params;

  const owned = await requireOwned<PaperRow>(papers, paperId, session.user.id);
  if (!owned.ok) return jsonError(owned.status, owned.status === 404 ? "not_found" : "forbidden");

  // GSD-132: BYOK → managed bucket → env. Anonymous users skip managed
  // lookup (no FK). Pre-stream 402 emit so client toast fires before SSE
  // bytes flow.
  const isAnon = Boolean(
    (session.user as { isAnonymous?: boolean }).isAnonymous,
  );
  let llmKey: string;
  try {
    llmKey = await getOrApiKey(isAnon ? null : session.user.id);
  } catch (err) {
    if (err instanceof OpenRouterTrialExhausted) {
      return Response.json({ error: "trial_exhausted" }, { status: 402 });
    }
    if (err instanceof OpenRouterKeyMissing) {
      return jsonError(400, "Add an OpenRouter key in Settings");
    }
    throw err;
  }

  const bodyText = await request.text();
  const path = "/agents/auto-highlight";
  const { headers } = signRequest({
    method: "POST",
    path,
    body: bodyText,
    userId: session.user.id,
    paperId,
    llmKey,
  });

  const upstream = await fetch(`${process.env.AGENTS_URL}${path}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: bodyText,
  });
  return streamPassthrough(upstream);
}

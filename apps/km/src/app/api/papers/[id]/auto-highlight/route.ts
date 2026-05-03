import { NextRequest } from "next/server";
import { auth } from "@episteme/auth/server";
import { getDecryptedApiKey } from "@episteme/auth/byok";
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

  let llmKey: string;
  try {
    llmKey = await getDecryptedApiKey(session.user.id);
  } catch {
    return jsonError(400, "Add an OpenRouter key in Settings");
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

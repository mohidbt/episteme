import { NextRequest } from "next/server";
import { auth } from "@episteme/auth/server";
import { getDecryptedApiKey } from "@episteme/auth/byok";
import { papers } from "@episteme/db/schema";
import { jsonError, requireOwned } from "@/lib/crud";
import { signRequest } from "@/lib/agents/sign-request";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };
type PaperRow = typeof papers.$inferSelect;

export async function GET(request: NextRequest, { params }: Ctx) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return jsonError(401, "unauthorized");
  const { id } = await params;

  const owned = await requireOwned<PaperRow>(papers, id, session.user.id);
  if (!owned.ok) return jsonError(owned.status, owned.status === 404 ? "not_found" : "forbidden");

  let llmKey: string;
  try { llmKey = await getDecryptedApiKey(session.user.id); }
  catch { return jsonError(400, "Add an OpenRouter key in Settings"); }

  const path = `/agents/outline?paperId=${id}`;
  const { headers } = signRequest({
    method: "GET",
    path,
    body: "",
    userId: session.user.id,
    paperId: id,
    llmKey,
  });
  const res = await fetch(`${process.env.AGENTS_URL}${path}`, { headers: { ...headers } });
  // GSD-126 P0: bucket exhaustion → stable JSON code, replacing whatever
  // upstream shape the agents service returned.
  if (res.status === 402) {
    return Response.json({ error: "trial_exhausted" }, { status: 402 });
  }
  return new Response(res.body, {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}

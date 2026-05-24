import { getSessionInfo } from "@/lib/auth";
import { signRequest } from "@/lib/agents/sign-request";

// K8 — list past agent threads for the open paper so the reader sidebar can
// surface a "past threads on this paper" dropdown. Mirrors the /state route's
// HMAC-signed proxy pattern; llmKey is empty because reads don't need the LLM.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ paperId: string }> },
) {
  const session = await getSessionInfo(req);
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { paperId } = await params;
  const path = `/agents/km/threads-for-paper/${paperId}`;
  const { headers } = signRequest({
    method: "GET",
    path,
    body: "",
    userId: session.userId,
    llmKey: "",
  });

  const upstream = await fetch(`${process.env.AGENTS_URL}${path}`, {
    method: "GET",
    headers: { ...headers } as Record<string, string>,
  });

  const body = await upstream.json();
  return Response.json(body, { status: upstream.status });
}

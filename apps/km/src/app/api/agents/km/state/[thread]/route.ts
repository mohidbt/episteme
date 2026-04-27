import { getSessionInfo } from "@/lib/auth";
import { signRequest } from "@/lib/agents/sign-request";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ thread: string }> },
) {
  const session = await getSessionInfo(req);
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { thread } = await params;
  const path = `/agents/km/state/${thread}`;
  const { headers } = signRequest({
    method: "GET",
    path,
    body: "",
    userId: session.userId,
    // llmKey not needed for state reads; passing empty for consistency with HMAC signing
    llmKey: "",
  });

  const upstream = await fetch(`${process.env.AGENTS_URL}${path}`, {
    method: "GET",
    headers: { ...headers } as Record<string, string>,
  });

  const body = await upstream.json();
  return Response.json(body, { status: upstream.status });
}

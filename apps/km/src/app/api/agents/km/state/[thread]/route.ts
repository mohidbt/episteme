import { getSessionInfo } from "@/lib/auth";
import { signRequest } from "@/lib/agents/sign-request";
import { isValidThreadId } from "@/lib/agents/thread-id";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ thread: string }> },
) {
  const session = await getSessionInfo(req);
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { thread } = await params;
  // Reject transport-unsafe thread_ids BEFORE signing: a `#`/`?`/`/` here would
  // make fetch re-parse the URL so the sent path diverges from the signed path
  // → a 401 that looks like an auth bug. Fail closed with a clear 400 instead.
  if (!isValidThreadId(thread)) {
    return Response.json({ error: "invalid_thread_id" }, { status: 400 });
  }
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

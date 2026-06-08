import { getSessionInfo } from "@/lib/auth";
import { signRequest } from "@/lib/agents/sign-request";

// 60s per-user cache. Tool inventory doesn't change at runtime, so re-asking
// the agent service on every PermissionToggles mount is wasted RTT. Keyed by
// userId so a future per-user-tool-set (e.g. MCP attachments) doesn't bleed
// across accounts.
type CacheEntry = { data: unknown; expiresAt: number };
const cache = new Map<string, CacheEntry>();
const TTL_MS = 60_000;

export function __resetCache() {
  cache.clear();
}

export async function GET(req: Request) {
  const session = await getSessionInfo(req);
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });

  const hit = cache.get(session.userId);
  if (hit && hit.expiresAt > Date.now()) {
    return Response.json(hit.data);
  }

  const downstreamUrl = process.env.AGENTS_URL;
  if (!downstreamUrl) {
    return Response.json({ error: "agents_unavailable" }, { status: 503 });
  }

  const { headers } = signRequest({
    method: "GET",
    path: "/agents/km/tools",
    body: "",
    userId: session.userId,
    llmKey: "",
  });

  let upstream: Response;
  try {
    upstream = await fetch(`${downstreamUrl}/agents/km/tools`, {
      method: "GET",
      headers: { ...headers },
    });
  } catch (err) {
    console.error("agents/km/tools: upstream fetch failed", err);
    return Response.json({ error: "upstream_unreachable" }, { status: 502 });
  }

  if (!upstream.ok) {
    return Response.json(
      { error: "upstream_error", status: upstream.status },
      { status: 502 },
    );
  }

  const data = await upstream.json();
  cache.set(session.userId, { data, expiresAt: Date.now() + TTL_MS });
  return Response.json(data);
}

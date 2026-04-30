import { getDecryptedApiKey } from "@episteme/auth/byok";
import { getSessionInfo } from "@/lib/auth";
import { signRequest } from "@/lib/agents/sign-request";
import { streamPassthrough } from "@/lib/agents/stream-passthrough";
import { rateLimit, getClientIp } from "@/lib/ai-rate-limit";
import { OPENROUTER_KEY_MISSING } from "@/lib/openrouter-errors";

const MAX_BODY_BYTES = 16 * 1024;

export async function POST(req: Request) {
  const session = await getSessionInfo(req);
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });

  const bodyText = await req.text();
  if (Buffer.byteLength(bodyText, "utf8") > MAX_BODY_BYTES) {
    return Response.json({ error: "payload_too_large" }, { status: 413 });
  }

  let llmKey: string;
  if (session.isAnonymous) {
    const ip = getClientIp(req);
    const rl = rateLimit(ip);
    if (!rl.allowed) {
      return Response.json(
        { error: "rate_limited", retryAfter: rl.retryAfter },
        { status: 429 },
      );
    }
    const sharedKey = process.env.EPISTEME_SHARED_LLM_KEY;
    if (!sharedKey) {
      console.error("ai-anon: shared key missing");
      return Response.json({ error: "agent_unavailable" }, { status: 502 });
    }
    llmKey = sharedKey;
  } else {
    try {
      llmKey = await getDecryptedApiKey(session.userId);
    } catch {
      return Response.json({ error: OPENROUTER_KEY_MISSING }, { status: 400 });
    }
  }

  const path = "/agents/km/chat";
  const { headers } = signRequest({
    method: "POST",
    path,
    body: bodyText,
    userId: session.userId,
    llmKey,
  });

  let upstream: Response;
  try {
    upstream = await fetch(`${process.env.AGENTS_URL}${path}`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: bodyText,
    });
  } catch (err) {
    if (session.isAnonymous) {
      console.error("ai-anon: upstream fetch threw");
      return Response.json({ error: "agent_unavailable" }, { status: 502 });
    }
    // Authed path: preserve original error (stack/cause) for ops debugging.
    // Anon masking above is intentional — never leak upstream details to anon clients.
    throw err;
  }

  if (session.isAnonymous && !upstream.ok) {
    // Never forward upstream body on anon path — may contain leaked key fragments.
    console.error("ai-anon: upstream non-ok");
    return Response.json({ error: "agent_unavailable" }, { status: 502 });
  }

  return streamPassthrough(upstream);
}

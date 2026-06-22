import {
  getOrApiKey,
  OpenRouterKeyMissing,
  OpenRouterTrialExhausted,
} from "@/lib/openrouter-key";
import { getSessionInfo } from "@/lib/auth";
import { signRequest } from "@/lib/agents/sign-request";
import { streamPassthrough } from "@/lib/agents/stream-passthrough";
import { rateLimit, getClientIp } from "@/lib/ai-rate-limit";
import { OPENROUTER_KEY_MISSING } from "@/lib/openrouter-errors";
import { assertGuestNotExhausted, GuestTrialExhausted } from "@/lib/guest-cap";

const MAX_BODY_BYTES = 16 * 1024;

export async function POST(req: Request) {
  const session = await getSessionInfo(req);
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });

  const bodyText = await req.text();
  if (Buffer.byteLength(bodyText, "utf8") > MAX_BODY_BYTES) {
    return Response.json({ error: "payload_too_large" }, { status: 413 });
  }

  // GSD-132: signed-in users resolve through BYOK → managed bucket → env.
  // Anonymous users retain the rate-limited EPISTEME_SHARED_LLM_KEY lane;
  // managed buckets have a FK to user_id so anon sessions can't lazy-provision.
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
    // GSD-130: server-side $1 cap on guest spend. Reuse the same 402
    // `trial_exhausted` envelope the signed-in path uses so the existing
    // client toast/CTA flow fires (with a guest-branch sign-up CTA copy).
    try {
      await assertGuestNotExhausted(session);
    } catch (err) {
      if (err instanceof GuestTrialExhausted) {
        return Response.json({ error: "trial_exhausted" }, { status: 402 });
      }
      throw err;
    }
    const sharedKey = process.env.EPISTEME_SHARED_LLM_KEY;
    if (!sharedKey) {
      console.error("ai-anon: shared key missing");
      return Response.json({ error: "agent_unavailable" }, { status: 502 });
    }
    llmKey = sharedKey;
  } else {
    try {
      llmKey = await getOrApiKey(session.userId);
    } catch (err) {
      if (err instanceof OpenRouterTrialExhausted) {
        return Response.json({ error: "trial_exhausted" }, { status: 402 });
      }
      if (err instanceof OpenRouterKeyMissing) {
        return Response.json({ error: OPENROUTER_KEY_MISSING }, { status: 400 });
      }
      throw err;
    }
  }

  const path = "/agents/km/complete";
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

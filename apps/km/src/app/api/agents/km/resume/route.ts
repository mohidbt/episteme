import { getDecryptedApiKey } from "@episteme/auth/byok";
import { getSessionInfo } from "@/lib/auth";
import { signRequest } from "@/lib/agents/sign-request";
import { streamPassthrough } from "@/lib/agents/stream-passthrough";

export async function POST(req: Request) {
  const session = await getSessionInfo(req);
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });

  let llmKey: string;
  try {
    llmKey = await getDecryptedApiKey(session.userId);
  } catch {
    return Response.json({ error: "no_api_key" }, { status: 400 });
  }

  const bodyText = await req.text();
  const path = "/agents/km/resume";
  const { headers } = signRequest({
    method: "POST",
    path,
    body: bodyText,
    userId: session.userId,
    llmKey,
  });

  const upstream = await fetch(`${process.env.AGENTS_URL}${path}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: bodyText,
  });

  return streamPassthrough(upstream);
}

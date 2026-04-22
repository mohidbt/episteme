import { getDecryptedApiKey } from "@episteme/auth/byok";
import { getUserIdFromRequest } from "@/lib/auth";
import { signRequest } from "@/lib/agents/sign-request";
import { streamPassthrough } from "@/lib/agents/stream-passthrough";

export async function POST(req: Request) {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

  let llmKey: string;
  try {
    llmKey = await getDecryptedApiKey(userId);
  } catch {
    return Response.json({ error: "add_openrouter_key" }, { status: 400 });
  }

  const bodyText = await req.text();
  const path = "/agents/km/chat";
  const { headers } = signRequest({
    method: "POST",
    path,
    body: bodyText,
    userId,
    llmKey,
  });

  const upstream = await fetch(`${process.env.AGENTS_URL}${path}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: bodyText,
  });
  return streamPassthrough(upstream);
}

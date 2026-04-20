import { NextRequest } from "next/server";
import { auth } from "@episteme/auth/server";
import { getDecryptedApiKey } from "@episteme/auth/byok";
import { signRequest } from "@/lib/agents/sign-request";
import { streamPassthrough } from "@/lib/agents/stream-passthrough";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  const documentId = Number(id);

  let llmKey: string;
  try {
    llmKey = await getDecryptedApiKey(session.user.id);
  } catch {
    return new Response("Add an OpenRouter key in Settings", { status: 400 });
  }

  const bodyText = await request.text();
  const path = "/agents/auto-highlight";
  const { headers } = signRequest({
    method: "POST",
    path,
    body: bodyText,
    userId: session.user.id,
    documentId,
    llmKey,
  });

  const upstream = await fetch(`${process.env.AGENTS_URL}${path}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: bodyText,
  });
  return streamPassthrough(upstream);
}

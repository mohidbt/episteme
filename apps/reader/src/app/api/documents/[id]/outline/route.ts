import { NextRequest, NextResponse } from "next/server";
import { auth } from "@episteme/auth/server";
import { getDecryptedApiKey } from "@episteme/auth/byok";
import { signRequest } from "@/lib/agents/sign-request";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const documentId = Number(id);

  let llmKey: string;
  try { llmKey = await getDecryptedApiKey(session.user.id); }
  catch { return NextResponse.json({ error: "Add an OpenRouter key in Settings" }, { status: 400 }); }

  const path = `/agents/outline?documentId=${documentId}`;
  const { headers } = signRequest({
    method: "GET",
    path,
    body: "",
    userId: session.user.id,
    documentId,
    llmKey,
  });
  const res = await fetch(`${process.env.AGENTS_URL}${path}`, { headers: { ...headers } });
  return new Response(res.body, {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}

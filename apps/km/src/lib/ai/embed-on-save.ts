import { getDecryptedApiKey } from "@episteme/auth/byok";
import { signRequest } from "@/lib/agents/sign-request";
import { chunkMarkdown } from "./note-chunking";

export async function embedOnSave(
  noteId: string,
  contentMd: string,
  userId: string,
): Promise<void> {
  try {
    const chunks = chunkMarkdown(contentMd);
    if (chunks.length === 0) return;
    const llmKey = await getDecryptedApiKey(userId);
    const path = "/agents/km/embed-note-chunks";
    const body = JSON.stringify({ noteId, chunks });
    const { headers } = signRequest({ method: "POST", path, body, userId, llmKey });
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15_000);
    try {
      const res = await fetch(`${process.env.AGENTS_URL}${path}`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body,
        signal: ctrl.signal,
      });
      if (!res.ok) console.warn("[embedOnSave] upstream", res.status);
    } finally {
      clearTimeout(t);
    }
  } catch (err) {
    console.warn("[embedOnSave] failed", err instanceof Error ? err.message : err);
  }
}

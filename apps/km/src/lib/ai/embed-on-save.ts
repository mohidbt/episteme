import {
  getOrApiKey,
  OpenRouterKeyMissing,
  OpenRouterTrialExhausted,
} from "@/lib/openrouter-key";
import { signRequest } from "@/lib/agents/sign-request";
import { chunkMarkdown } from "./note-chunking";

// GSD-132: resolve through BYOK → managed bucket → env. The caller path
// (save-note-md.ts) is fire-and-forget: any thrown error (Missing,
// TrialExhausted, network) is swallowed with a console.warn so the note
// save itself never fails. Trial-exhausted users still save notes; the
// embedding turn is best-effort and lags until they top up the bucket.
export async function embedOnSave(
  noteId: string,
  contentMd: string,
  userId: string,
): Promise<void> {
  try {
    const chunks = chunkMarkdown(contentMd);
    if (chunks.length === 0) return;
    const llmKey = await getOrApiKey(userId);
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
    if (err instanceof OpenRouterTrialExhausted) {
      console.warn("[embedOnSave] skipped — trial exhausted");
      return;
    }
    if (err instanceof OpenRouterKeyMissing) {
      console.warn("[embedOnSave] skipped — no OpenRouter key");
      return;
    }
    console.warn("[embedOnSave] failed", err instanceof Error ? err.message : err);
  }
}

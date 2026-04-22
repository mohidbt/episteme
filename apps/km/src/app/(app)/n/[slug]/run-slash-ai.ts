// Regex: a paragraph whose text is exactly `/ai <prompt>`.
// Slash must be at line start (no leading whitespace). Prompt must be non-empty.
export const SLASH_AI_REGEX = /^\/ai\s+(.+)$/;

export type RunSlashAiArgs = {
  prompt: string;
  context?: string;
  onToken: (chunk: string) => void;
  onError: (message: string) => void;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
};

type SseEvent =
  | { type: "token"; content: string }
  | { type: "error"; message: string };

/**
 * POSTs /api/ai/complete with {prompt, context?}, parses SSE stream, and
 * invokes onToken for each token event. Halts on error event. Stops on [DONE].
 */
export async function runSlashAi(args: RunSlashAiArgs): Promise<void> {
  const { prompt, context, onToken, onError, signal } = args;
  const doFetch = args.fetchImpl ?? globalThis.fetch;

  const payload: { prompt: string; context?: string } = { prompt };
  if (context !== undefined) payload.context = context;

  let res: Response;
  try {
    res = await doFetch("/api/ai/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
  } catch (err) {
    onError((err as Error)?.message ?? "network error");
    return;
  }

  if (!res.ok || !res.body) {
    onError(`http ${res.status}`);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let halted = false;

  while (!halted) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    // SSE: events separated by blank line (\n\n).
    let sep: number;
    while ((sep = buf.indexOf("\n\n")) !== -1) {
      const rawEvent = buf.slice(0, sep);
      buf = buf.slice(sep + 2);

      // Each event may have multiple `data: ` lines; collect their payloads.
      const dataLines = rawEvent
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).replace(/^ /, ""));
      if (dataLines.length === 0) continue;
      const data = dataLines.join("\n");

      if (data === "[DONE]") {
        halted = true;
        break;
      }

      let evt: SseEvent;
      try {
        evt = JSON.parse(data) as SseEvent;
      } catch {
        continue;
      }
      if (evt.type === "token") {
        onToken(evt.content);
      } else if (evt.type === "error") {
        onError(evt.message);
        halted = true;
        break;
      }
    }
  }

  try {
    reader.releaseLock();
  } catch {
    /* noop */
  }
}

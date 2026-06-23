import {
  TrialExhaustedError,
  fetchOrThrowTrialExhausted,
  surfaceTrialExhaustedToast,
  maybeNotifyUsageThreshold,
} from "@/lib/trial-exhausted";

// Regex: a paragraph whose text is exactly `/ai <prompt>`.
// Slash must be at line start (no leading whitespace). Prompt must be non-empty.
export const SLASH_AI_REGEX = /^\/ai\s+(.+)$/;

export type RunSlashAiArgs = {
  prompt: string;
  context?: string;
  mode?: "rephrase" | "generate";
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
  const { prompt, context, mode, onToken, onError, signal } = args;
  const doFetch = args.fetchImpl ?? globalThis.fetch;

  const payload: { prompt: string; context?: string; mode?: string } = { prompt };
  if (context !== undefined) payload.context = context;
  if (mode !== undefined) payload.mode = mode;

  let res: Response;
  try {
    res = await fetchOrThrowTrialExhausted(
      "/api/ai/complete",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal,
      },
      doFetch,
    );
  } catch (err) {
    // Abort is a silent cancellation — not a user-facing error.
    if ((err as Error)?.name === "AbortError") return;
    // GSD-130: a 402 trial_exhausted surfaces the shared upgrade/sign-up
    // toast (guest vs signed-in copy auto-detected from <main data-anon>),
    // not the inline `[ai error: …]` string.
    if (err instanceof TrialExhaustedError) {
      surfaceTrialExhaustedToast();
      return;
    }
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
  let sawError = false;

  while (!halted) {
    let readResult: ReadableStreamReadResult<Uint8Array>;
    try {
      readResult = await reader.read();
    } catch (err) {
      // Abort is a silent cancellation — not a user-facing error.
      if ((err as Error)?.name === "AbortError") {
        try {
          reader.releaseLock();
        } catch {
          /* noop */
        }
        return;
      }
      throw err;
    }
    const { value, done } = readResult;
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
        sawError = true;
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

  // GSD-139: a cleanly-completed AI stream (no error frame) just billed the
  // managed bucket — opportunistically check whether the signed-in user
  // crossed a spend threshold (70% / 90%) and nudge them to subscribe before
  // the hard 402 at 100%. Fire-and-forget; never blocks.
  if (!sawError) void maybeNotifyUsageThreshold();
}

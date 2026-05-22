import type { AgentThreadStatus } from "@/lib/threads";

export interface UsageObservation {
  model: string;
  promptTokens: number;
  completionTokens: number;
}

/**
 * Tap an SSE byte stream: forward bytes unchanged to the consumer while
 * watching for `event: <name>` lines and firing a status callback.
 *
 * - `interrupt` event => "awaiting_hitl"
 * - `done` event     => "idle"
 * - read error / abort => "error"
 *
 * Optional `onUsage` receives parsed `event: usage` payloads (one per
 * `on_chat_model_end` upstream). The original stream is forwarded
 * byte-for-byte; status + usage callbacks are dispatched fire-and-forget on
 * a tee'd branch so DB writes never block client byte delivery.
 */
export function tapAgentEvents(
  upstream: ReadableStream<Uint8Array>,
  onStatus: (status: AgentThreadStatus) => void | Promise<void>,
  onUsage?: (u: UsageObservation) => void | Promise<void>,
): ReadableStream<Uint8Array> {
  const [forward, parse] = upstream.tee();

  // Background-parse the second branch. Don't await — failures must not
  // crash the forwarded stream.
  void (async () => {
    const reader = parse.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let pendingEvent: string | null = null;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        buffer += decoder.decode(value, { stream: true });

        // Process complete lines; keep the trailing partial line in buffer.
        let nlIdx: number;
        while ((nlIdx = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, nlIdx).replace(/\r$/, "");
          buffer = buffer.slice(nlIdx + 1);
          if (line.startsWith("event:")) {
            pendingEvent = line.slice(6).trim();
            if (pendingEvent === "interrupt") {
              await safeStatus(onStatus, "awaiting_hitl");
            } else if (pendingEvent === "done") {
              await safeStatus(onStatus, "idle");
            }
          } else if (line.startsWith("data:") && pendingEvent === "usage" && onUsage) {
            const raw = line.slice(5).trim();
            try {
              const data = JSON.parse(raw) as {
                model?: string;
                prompt_tokens?: number;
                completion_tokens?: number;
              };
              await safeUsage(onUsage, {
                model: String(data.model ?? ""),
                promptTokens: Number(data.prompt_tokens ?? 0),
                completionTokens: Number(data.completion_tokens ?? 0),
              });
            } catch {
              /* malformed usage frame — ignore */
            }
          } else if (line === "") {
            // Blank line terminates an SSE frame.
            pendingEvent = null;
          }
        }
      }
    } catch {
      await safeStatus(onStatus, "error");
    } finally {
      try {
        reader.releaseLock();
      } catch {
        /* noop */
      }
    }
  })();

  return forward;
}

async function safeStatus(
  fn: (s: AgentThreadStatus) => void | Promise<void>,
  status: AgentThreadStatus,
): Promise<void> {
  try {
    await fn(status);
  } catch (err) {
    console.warn("[thread-lifecycle] status update failed", status, err);
  }
}

async function safeUsage(
  fn: (u: UsageObservation) => void | Promise<void>,
  u: UsageObservation,
): Promise<void> {
  try {
    await fn(u);
  } catch (err) {
    console.warn("[thread-lifecycle] usage record failed", err);
  }
}

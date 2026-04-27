import type { AgentThreadStatus } from "@/lib/threads";

/**
 * Tap an SSE byte stream: forward bytes unchanged to the consumer while
 * watching for `event: <name>` lines and firing a status callback.
 *
 * - `interrupt` event => "awaiting_hitl"
 * - `done` event     => "idle"
 * - read error / abort => "error"
 *
 * The original stream is forwarded byte-for-byte; status updates are
 * dispatched fire-and-forget on a tee'd branch so DB writes never block
 * client byte delivery.
 */
export function tapAgentEvents(
  upstream: ReadableStream<Uint8Array>,
  onStatus: (status: AgentThreadStatus) => void | Promise<void>,
): ReadableStream<Uint8Array> {
  const [forward, parse] = upstream.tee();

  // Background-parse the second branch. Don't await — failures must not
  // crash the forwarded stream.
  void (async () => {
    const reader = parse.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
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
            const name = line.slice(6).trim();
            if (name === "interrupt") {
              await safeCall(onStatus, "awaiting_hitl");
            } else if (name === "done") {
              await safeCall(onStatus, "idle");
            }
          }
        }
      }
    } catch {
      await safeCall(onStatus, "error");
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

async function safeCall(
  fn: (s: AgentThreadStatus) => void | Promise<void>,
  status: AgentThreadStatus,
): Promise<void> {
  try {
    await fn(status);
  } catch {
    /* swallow — lifecycle updates must never break the stream */
  }
}

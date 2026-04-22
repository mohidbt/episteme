export interface Source {
  id: string;
  title: string;
  slug: string;
  snippet: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface RunAskNotesInput {
  question: string;
  history: ChatMessage[];
  signal?: AbortSignal;
  onSources: (notes: Source[]) => void;
  onToken: (content: string) => void;
  onError?: (message: string) => void;
  fetchImpl?: typeof fetch;
}

type SseEvent =
  | { type: "sources"; notes: Source[] }
  | { type: "token"; content: string }
  | { type: "error"; message: string };

/**
 * POSTs /api/ai/chat with {question, history}, parses SSE events, dispatches
 * sources/token events via callbacks. Halts on error or [DONE]. Silent on abort.
 */
export async function runAskNotes(input: RunAskNotesInput): Promise<void> {
  const { question, history, signal, onSources, onToken, onError } = input;
  const doFetch = input.fetchImpl ?? globalThis.fetch;

  let res: Response;
  try {
    res = await doFetch("/api/ai/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question, history }),
      signal,
    });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") return;
    onError?.((err as Error)?.message ?? "network error");
    return;
  }

  if (!res.ok || !res.body) {
    onError?.(`http ${res.status}`);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let halted = false;

  while (!halted) {
    let readResult: ReadableStreamReadResult<Uint8Array>;
    try {
      readResult = await reader.read();
    } catch (err) {
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

    let sep: number;
    while ((sep = buf.indexOf("\n\n")) !== -1) {
      const rawEvent = buf.slice(0, sep);
      buf = buf.slice(sep + 2);

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
      if (evt.type === "sources") {
        onSources(evt.notes);
      } else if (evt.type === "token") {
        onToken(evt.content);
      } else if (evt.type === "error") {
        onError?.(evt.message);
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

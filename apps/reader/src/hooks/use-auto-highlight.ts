"use client";
import { useCallback, useState } from "react";

export type HighlightCommand =
  | { matched: true; instruction: string }
  | { matched: false };

/**
 * Detects the `/highlight ...` slash command. Returns the instruction with
 * surrounding whitespace stripped. An empty instruction still matches — the
 * caller should decide whether to show a usage hint instead of sending.
 */
export function parseHighlightCommand(raw: string): HighlightCommand {
  const text = raw.trimStart();
  // Only the exact `/highlight` token followed by end/whitespace matches;
  // `/highlights`, `/high` etc. do not.
  const m = /^\/highlight(?:\s+([\s\S]*))?$/.exec(text);
  if (!m) return { matched: false };
  return { matched: true, instruction: (m[1] ?? "").trim() };
}

export interface AutoHighlightCallbacks {
  onRun?: (args: { runId: string; conversationId: number }) => void;
  onProgress?: (args: { step: string; detail: string }) => void;
  onError?: (message: string) => void;
  onDone?: (args: { summary: string; highlightsCount: number }) => void;
}

interface RunOptions extends AutoHighlightCallbacks {
  conversationId?: number;
}

type SseEvent =
  | { type: "run"; runId: string; conversationId: number }
  | { type: "progress"; step: string; detail: string }
  | { type: "error"; message: string }
  | { type: "done"; summary: string; highlightsCount: number };

export function useAutoHighlight(documentId: number) {
  const [running, setRunning] = useState(false);

  const runAutoHighlight = useCallback(
    async (instruction: string, options: RunOptions = {}) => {
      if (running) return;
      setRunning(true);
      const { onRun, onProgress, onError, onDone, conversationId } = options;

      try {
        const body: { instruction: string; conversationId?: number } = { instruction };
        if (conversationId != null) body.conversationId = conversationId;
        const res = await fetch(`/api/documents/${documentId}/auto-highlight`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          onError?.(text || `HTTP ${res.status}`);
          return;
        }
        if (!res.body) {
          onError?.("No response body");
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        outer: while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop()!;
          for (const part of parts) {
            if (!part.startsWith("data: ")) continue;
            const data = part.slice(6).trim();
            if (data === "[DONE]") break outer;
            let parsed: SseEvent;
            try {
              parsed = JSON.parse(data) as SseEvent;
            } catch {
              continue;
            }
            switch (parsed.type) {
              case "run":
                onRun?.({ runId: parsed.runId, conversationId: parsed.conversationId });
                break;
              case "progress":
                onProgress?.({ step: parsed.step, detail: parsed.detail });
                break;
              case "error":
                onError?.(parsed.message);
                break;
              case "done":
                onDone?.({
                  summary: parsed.summary,
                  highlightsCount: parsed.highlightsCount,
                });
                break;
            }
          }
        }
      } catch (err) {
        onError?.(err instanceof Error ? err.message : "Auto-highlight failed");
      } finally {
        setRunning(false);
      }
    },
    [documentId, running]
  );

  return { runAutoHighlight, running };
}

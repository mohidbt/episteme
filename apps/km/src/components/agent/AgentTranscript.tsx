"use client";

import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  agentStreamReducer,
  initialAgentTranscriptState,
  type TranscriptCard,
} from "@/lib/agent-stream-reducer";
import type { AgentEvent } from "@/lib/agent-events";
import type { PageContext } from "@/lib/page-context";

export interface AgentTranscriptProps {
  threadId: string;
  fullHeight?: boolean;
  pageContext?: PageContext;
  onSendMessage?: (text: string) => void;
}

/**
 * Parse a chunk of SSE text. Handles partial frames via `buffer` arg.
 * Returns parsed events + remaining un-terminated buffer.
 */
function parseSseChunk(
  buffer: string,
): { events: AgentEvent[]; rest: string } {
  const events: AgentEvent[] = [];
  // Split on blank line which terminates an SSE frame.
  const parts = buffer.split(/\n\n/);
  const rest = parts.pop() ?? "";
  for (const frame of parts) {
    let eventName: string | undefined;
    const dataLines: string[] = [];
    for (const line of frame.split("\n")) {
      if (line.startsWith("event:")) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trim());
      }
    }
    if (dataLines.length === 0) continue;
    try {
      const data = JSON.parse(dataLines.join("\n"));
      if (eventName && !data.type) data.type = eventName;
      events.push(data as AgentEvent);
    } catch {
      // Drop malformed frame.
    }
  }
  return { events, rest };
}

export function AgentTranscript({
  threadId,
  fullHeight = false,
  pageContext,
  onSendMessage,
}: AgentTranscriptProps) {
  const [state, dispatch] = useReducer(
    agentStreamReducer,
    initialAgentTranscriptState,
  );
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const defaultSend = useCallback(
    async (text: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setStreaming(true);
      try {
        const res = await fetch("/api/agents/km/invoke", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            thread_id: threadId,
            message: text,
            page_context: pageContext ?? {},
          }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          setStreaming(false);
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        // Stream loop.
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const { events, rest } = parseSseChunk(buf);
          buf = rest;
          for (const ev of events) dispatch(ev);
        }
      } catch {
        // Aborted or network — silent for MVP.
      } finally {
        setStreaming(false);
      }
    },
    [threadId, pageContext],
  );

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    if (onSendMessage) onSendMessage(text);
    else void defaultSend(text);
  }, [input, onSendMessage, defaultSend]);

  return (
    <div
      className={`flex flex-col ${fullHeight ? "h-full" : "h-[520px]"}`}
      data-testid="agent-transcript"
    >
      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2 text-sm">
        {state.cards.length === 0 ? (
          <div className="text-muted-foreground text-xs">
            No messages yet. Ask the agent something.
          </div>
        ) : (
          state.cards.map((card, i) => (
            <CardView key={`${card.kind}-${i}`} card={card} />
          ))
        )}
        {streaming ? (
          <div className="text-muted-foreground text-xs" data-testid="streaming-indicator">
            …
          </div>
        ) : null}
      </div>
      <div className="border-t p-2 flex gap-2">
        <textarea
          className="flex-1 resize-none rounded-md border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring min-h-[36px] max-h-[120px]"
          placeholder="Message agent…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          rows={1}
          aria-label="Message agent"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={!input.trim() || streaming}
          className="rounded-md bg-primary px-3 py-1 text-sm text-primary-foreground disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </div>
  );
}

function CardView({ card }: { card: TranscriptCard }) {
  // MVP placeholder rendering. Task #7 swaps for AI Elements.
  switch (card.kind) {
    case "text":
      return (
        <div data-testid="card-text" className="whitespace-pre-wrap">
          {card.text}
        </div>
      );
    case "thinking":
      return (
        <div
          data-testid="card-thinking"
          className="text-xs italic text-muted-foreground whitespace-pre-wrap"
        >
          {card.text}
        </div>
      );
    case "tool":
      return (
        <div data-testid="card-tool" className="rounded border p-2 text-xs">
          <div className="font-mono">tool: {card.name}</div>
          <div className="text-muted-foreground">state: {card.state}</div>
        </div>
      );
    case "interrupt":
      return (
        <div
          data-testid="card-interrupt"
          className="rounded border border-amber-500 p-2 text-xs"
        >
          interrupt: {card.tool}
        </div>
      );
    case "skill_load":
      return (
        <div data-testid="card-skill_load" className="text-xs">
          skill: {card.name}
        </div>
      );
    case "file_diff":
      return (
        <div data-testid="card-file_diff" className="rounded border p-2 text-xs">
          file_diff: {card.noteId}
        </div>
      );
    case "suggestion":
      return (
        <div data-testid="card-suggestion" className="text-xs">
          suggestions: {card.items.join(", ")}
        </div>
      );
    default: {
      const _: never = card;
      void _;
      return null;
    }
  }
}

"use client";
import { useState, useCallback, useEffect, useRef } from "react";
import { ViewportContext } from "./use-viewport-tracking";

export interface ChatAttachment {
  text: string;
  pageNumber: number;
}

export type ChatMessageKind =
  | "chat"
  | "auto-highlight-progress"
  | "auto-highlight-result";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  attachment?: ChatAttachment;
  // Auto-highlight metadata (populated only for kind !== "chat").
  kind?: ChatMessageKind;
  runId?: string;
  highlightsCount?: number;
  progressSteps?: string[];
}

export interface ChatSource {
  page: number;
  relevance: number;
}

export type ChatScope = "page" | "selection" | "paper" | "segment";

export interface ChatSendOptions {
  scope?: ChatScope;
  selectionText?: string;
  pageNumber?: number;
  attachment?: ChatAttachment;
}

export interface UseChatOptions {
  onHighlightsChanged?: () => void;
}

export function useChat(documentId: number, options?: UseChatOptions) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sources, setSources] = useState<ChatSource[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<number | undefined>();

  // Ref avoids re-creating sendMessage (and its stale closures) on every
  // render when the caller passes an inline callback.
  const onHighlightsChangedRef = useRef(options?.onHighlightsChanged);
  useEffect(() => {
    onHighlightsChangedRef.current = options?.onHighlightsChanged;
  }, [options?.onHighlightsChanged]);

  const sendMessage = useCallback(
    async (
      question: string,
      viewportContext: ViewportContext,
      options?: ChatSendOptions
    ) => {
      if (!question.trim() || streaming) return;

      setMessages((prev) => [
        ...prev,
        { role: "user", content: question, attachment: options?.attachment },
      ]);
      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);
      setSources([]);
      setStreaming(true);
      setError(null);

      try {
        const response = await fetch(`/api/documents/${documentId}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question,
            viewportContext,
            history: messages.slice(-10),
            conversationId,
            scope: options?.scope ?? "paper",
            selectionText: options?.selectionText,
            pageNumber: options?.pageNumber ?? viewportContext?.page,
          }),
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(text || `HTTP ${response.status}`);
        }

        if (!response.body) throw new Error("No response body");
        const reader = response.body.getReader();
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
            try {
              const parsed = JSON.parse(data) as {
                type: string;
                content?: string;
                sources?: ChatSource[];
                message?: string;
                conversationId?: number;
                step?: string;
                label?: string;
                detail?: string;
                runId?: string;
                count?: number;
              };
              if (parsed.type === "sources" && parsed.sources) {
                setSources(parsed.sources);
                if (parsed.conversationId != null) {
                  setConversationId(parsed.conversationId);
                }
              } else if (parsed.type === "token" && parsed.content) {
                setMessages((prev) => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  updated[updated.length - 1] = {
                    ...last,
                    content: last.content + parsed.content,
                  };
                  return updated;
                });
              } else if (parsed.type === "highlight_progress") {
                const label = parsed.detail ?? parsed.label ?? parsed.step;
                if (label) {
                  setMessages((prev) => {
                    const updated = [...prev];
                    const last = updated[updated.length - 1];
                    updated[updated.length - 1] = {
                      ...last,
                      kind: "auto-highlight-progress",
                      progressSteps: [...(last.progressSteps ?? []), label],
                    };
                    return updated;
                  });
                }
              } else if (parsed.type === "highlight_done") {
                setMessages((prev) => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  updated[updated.length - 1] = {
                    ...last,
                    kind: "auto-highlight-result",
                    runId: parsed.runId,
                    highlightsCount: parsed.count,
                    progressSteps: undefined,
                  };
                  return updated;
                });
                onHighlightsChangedRef.current?.();
              } else if (parsed.type === "error") {
                setError(parsed.message ?? "Streaming error");
              }
            } catch {
              // skip malformed chunks
            }
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to send message");
        setMessages((prev) => prev.slice(0, -1));
      } finally {
        setStreaming(false);
      }
    },
    [documentId, messages, streaming, conversationId]
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
    setSources([]);
    setError(null);
    setConversationId(undefined);
  }, []);

  const loadConversation = useCallback(async (id: number) => {
    try {
      const res = await fetch(`/api/conversations/${id}/messages`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        messages: { role: "user" | "assistant"; content: string }[];
      };
      setMessages(data.messages.map((m) => ({ role: m.role, content: m.content })));
      setSources([]);
      setError(null);
      setConversationId(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load conversation");
    }
  }, []);

  return {
    messages,
    setMessages,
    sources,
    streaming,
    error,
    conversationId,
    setConversationId,
    sendMessage,
    clearMessages,
    loadConversation,
  };
}

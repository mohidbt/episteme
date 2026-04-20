"use client";
import { useState, useRef, useEffect, useCallback, type ReactNode } from "react";
import { X, Sparkles } from "lucide-react";
import { useChat, type ChatScope, type ChatMessage as ChatMessageType } from "@/hooks/use-chat";
import { useViewportTracking } from "@/hooks/use-viewport-tracking";
import { useReaderState } from "@/hooks/use-reader-state";
import { parseHighlightCommand, useAutoHighlight } from "@/hooks/use-auto-highlight";
import { ChatMessage } from "./chat-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

export interface ChatSeed {
  text: string;
  pageNumber?: number;
  scope?: ChatScope;
  nonce: number;
}

type DocProcessingStatus = "pending" | "processing" | "ready" | "failed";

interface ChatPanelProps {
  documentId: number;
  open: boolean;
  scrollContainerRef: React.RefObject<HTMLElement | null>;
  seed?: ChatSeed | null;
  onClearSeed?: () => void;
  dockControl?: ReactNode;
  currentPage?: number;
  processingStatus?: DocProcessingStatus;
  // Called after /highlight finishes so the parent can refetch highlights.
  onHighlightsChanged?: () => void;
  // Called when the user clicks the "Review highlights" button in an
  // auto-highlight result message. Parent opens the Highlights sidebar and
  // ensures the run's overlays are visible.
  onReviewRun?: (runId: string) => void;
}

interface ConversationListItem {
  id: number;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

// UI-level scope. Backend still accepts "selection"; we pick it automatically
// when an attached selection exists.
type UiScope = "page" | "paper";

export function ChatPanel({
  documentId,
  open,
  scrollContainerRef,
  seed,
  onClearSeed,
  dockControl,
  currentPage,
  processingStatus = "ready",
  onHighlightsChanged,
  onReviewRun,
}: ChatPanelProps) {
  const [input, setInput] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [uiScope, setUiScope] = useState<UiScope>("paper");
  // Highlight text attached via Ask-AI. Travels with the next send as
  // scope="selection". Shown as a dismissable chip above the input so the
  // user knows the bot has the highlighted passage in context.
  const [attachedSelection, setAttachedSelection] = useState<{
    text: string;
    pageNumber: number;
  } | null>(null);
  // Segment context chip — shown when the user clicks an explain icon.
  // prefix = pre-filled input text; payload = context shown in the chip.
  const [segmentChip, setSegmentChip] = useState<{
    prefix: string;
    payload: string;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const viewportRef = useViewportTracking(scrollContainerRef);
  const {
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
  } = useChat(documentId, { onHighlightsChanged });
  const { runAutoHighlight, running: autoHighlightRunning } = useAutoHighlight(documentId);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!seed) return;
    // The highlighted text goes into the chip only — never into the input
    // field. The user types their own question.
    if (seed.scope === "selection" && seed.pageNumber != null) {
      setAttachedSelection({ text: seed.text, pageNumber: seed.pageNumber });
      setUiScope("page");
    } else if (seed.scope === "segment") {
      // Split "Explain this X.\n\n<payload>" into prefix + payload chip.
      const splitIdx = seed.text.indexOf("\n\n");
      const prefix = splitIdx !== -1 ? seed.text.slice(0, splitIdx) : seed.text;
      const payload = splitIdx !== -1 ? seed.text.slice(splitIdx + 2) : "";
      setSegmentChip({ prefix, payload });
      setInput(prefix);
      setUiScope("page");
    } else if (seed.scope === "page") {
      setUiScope("page");
    } else {
      setUiScope("paper");
    }
    inputRef.current?.focus();
  }, [seed]);

  const fetchConversations = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const res = await fetch(`/api/documents/${documentId}/conversations`);
      if (res.ok) {
        const data = (await res.json()) as { conversations: ConversationListItem[] };
        setConversations(data.conversations);
      }
    } finally {
      setLoadingHistory(false);
    }
  }, [documentId]);

  useEffect(() => {
    if (historyOpen) fetchConversations();
  }, [historyOpen, fetchConversations, conversationId]);


  const pageAvailable = currentPage != null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || streaming || autoHighlightRunning) return;
    const q = input;
    setInput("");

    // Intercept `/highlight ...` before it hits the chat endpoint.
    const cmd = parseHighlightCommand(q);
    if (cmd.matched) {
      if (!cmd.instruction) {
        setMessages((prev) => [
          ...prev,
          { role: "user", content: q },
          {
            role: "assistant",
            content: "Try: `/highlight where the loss function is described`",
            kind: "auto-highlight-result",
          },
        ]);
        return;
      }
      // Seed the transcript: user message + ephemeral progress message.
      setMessages((prev) => [
        ...prev,
        { role: "user", content: q },
        {
          role: "assistant",
          content: "",
          kind: "auto-highlight-progress",
          progressSteps: [],
        },
      ]);
      const appendProgress = (line: string) => {
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (!last || last.kind !== "auto-highlight-progress") return prev;
          updated[updated.length - 1] = {
            ...last,
            progressSteps: [...(last.progressSteps ?? []), line],
          };
          return updated;
        });
      };
      const finalizeAssistant = (patch: Partial<ChatMessageType>) => {
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (!last || last.role !== "assistant") return prev;
          updated[updated.length - 1] = { ...last, ...patch };
          return updated;
        });
      };
      await runAutoHighlight(cmd.instruction, {
        conversationId,
        onRun: ({ runId, conversationId: convId }) => {
          if (convId != null) setConversationId(convId);
          finalizeAssistant({ runId });
        },
        onProgress: ({ detail }) => appendProgress(detail),
        onError: (msg) =>
          finalizeAssistant({
            kind: "auto-highlight-result",
            content: `Error: ${msg}`,
            progressSteps: undefined,
          }),
        onDone: ({ summary, highlightsCount }) => {
          finalizeAssistant({
            kind: "auto-highlight-result",
            content: summary || `Created ${highlightsCount} highlight(s).`,
            highlightsCount,
            progressSteps: undefined,
          });
          onHighlightsChanged?.();
        },
      });
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      return;
    }

    let sendOptions: {
      scope: ChatScope;
      selectionText?: string;
      pageNumber?: number;
      attachment?: { text: string; pageNumber: number };
    };
    if (attachedSelection) {
      sendOptions = {
        scope: "selection",
        selectionText: attachedSelection.text,
        pageNumber: attachedSelection.pageNumber,
        attachment: {
          text: attachedSelection.text,
          pageNumber: attachedSelection.pageNumber,
        },
      };
    } else if (uiScope === "page" && pageAvailable) {
      sendOptions = { scope: "page", pageNumber: currentPage };
    } else {
      sendOptions = { scope: "paper" };
    }

    await sendMessage(
      q,
      viewportRef.current ?? { page: currentPage ?? 1, scrollPct: 0 },
      sendOptions
    );
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const dismissChip = () => {
    setAttachedSelection(null);
    setSegmentChip(null);
    onClearSeed?.();
  };

  const handleLoad = async (id: number) => {
    await loadConversation(id);
    dismissChip();
    setHistoryOpen(false);
  };

  const handleNew = () => {
    clearMessages();
    dismissChip();
    setInput("");
    setUiScope("paper");
    setHistoryOpen(false);
  };

  if (!open) return null;

  const pageLabel = pageAvailable ? `Page ${currentPage}` : "Page";
  const paperDisabled = attachedSelection != null;
  const smartOn = uiScope === "page" || attachedSelection != null;
  const docReady = processingStatus === "ready";
  const statusBanner =
    processingStatus === "pending" || processingStatus === "processing"
      ? { tone: "info" as const, text: "Document is still being processed. Refresh in a minute." }
      : processingStatus === "failed"
        ? { tone: "error" as const, text: "Upload failed. Please re-upload to chat." }
        : null;

  const handleJumpToPage = (page: number) => {
    useReaderState.getState().setScrollTargetPage(page);
  };

  return (
    <div className="flex flex-col h-full w-full bg-background">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <span className="truncate text-sm font-medium">AI Assistant</span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={handleNew}
            aria-label="New conversation"
          >
            New
          </Button>
          <Button
            variant={historyOpen ? "secondary" : "ghost"}
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setHistoryOpen((v) => !v)}
            aria-label="Conversation history"
          >
            History
          </Button>
          {dockControl}
        </div>
      </div>
      {historyOpen && (
        <div className="border-b bg-muted/30 p-2 max-h-60 overflow-y-auto">
          {loadingHistory && (
            <p className="px-2 py-1 text-xs text-muted-foreground">Loading…</p>
          )}
          {!loadingHistory && conversations.length === 0 && (
            <p className="px-2 py-1 text-xs text-muted-foreground">No past conversations</p>
          )}
          {!loadingHistory &&
            conversations.map((c) => {
              const isActive = c.id === conversationId;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => handleLoad(c.id)}
                  className={`w-full rounded px-2 py-1.5 text-left text-xs hover:bg-background ${
                    isActive ? "bg-background font-medium" : ""
                  }`}
                >
                  <div className="truncate">{c.title || `Conversation #${c.id}`}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {new Date(c.updatedAt).toLocaleString()}
                  </div>
                </button>
              );
            })}
        </div>
      )}
      <div className="flex-1 overflow-y-auto p-3">
        {messages.length === 0 && (
          <p className="text-xs text-muted-foreground text-center mt-4">
            Ask a question about this paper
          </p>
        )}
        {messages.map((msg, i) => {
          const isLast = i === messages.length - 1;
          const isStreaming =
            isLast &&
            msg.role === "assistant" &&
            (streaming || (autoHighlightRunning && msg.kind === "auto-highlight-progress"));
          return (
            <ChatMessage
              key={i}
              role={msg.role}
              content={msg.content}
              attachment={msg.attachment}
              kind={msg.kind}
              progressSteps={msg.progressSteps}
              highlightsCount={msg.highlightsCount}
              runId={msg.runId}
              onReviewHighlights={onReviewRun}
              isStreaming={isStreaming}
            />
          );
        })}
        <div ref={messagesEndRef} />
      </div>
      <div className="border-t px-3 pt-2 space-y-2">
        {sources.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-[10px] font-medium text-muted-foreground mr-1">
              Cited:
            </span>
            {sources.map((s, i) => (
              <button
                key={i}
                type="button"
                onClick={() => handleJumpToPage(s.page)}
                title={`Jump to page ${s.page}`}
                className="inline-flex items-center rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-medium text-foreground transition-colors hover:bg-muted cursor-pointer"
              >
                Page {s.page}
              </button>
            ))}
          </div>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
        {attachedSelection && (
          <div className="flex items-start gap-2 rounded-md border border-border bg-background px-2 py-1.5">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-medium text-foreground">
                Highlighted · Page {attachedSelection.pageNumber}
              </p>
              <p className="line-clamp-2 text-xs text-muted-foreground">
                "{attachedSelection.text}"
              </p>
            </div>
            <button
              type="button"
              onClick={dismissChip}
              aria-label="Remove highlighted context"
              className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </div>
        )}
        {segmentChip && segmentChip.payload && (
          <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-2 py-1.5">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-medium text-foreground">Context</p>
              <code className="block whitespace-pre-wrap break-all text-xs text-muted-foreground">
                {segmentChip.payload}
              </code>
            </div>
            <button
              type="button"
              onClick={dismissChip}
              aria-label="Remove segment context"
              className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </div>
        )}
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={!pageAvailable}
            onClick={() => setUiScope("page")}
            className={cn(
              "rounded border px-2 py-0.5 text-[10px] transition-colors",
              uiScope === "page" && pageAvailable
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background text-muted-foreground hover:bg-muted",
              !pageAvailable && "opacity-50 cursor-not-allowed hover:bg-background"
            )}
            aria-pressed={uiScope === "page" && pageAvailable}
          >
            {pageLabel}
          </button>
          <button
            type="button"
            disabled={paperDisabled}
            onClick={() => setUiScope("paper")}
            className={cn(
              "rounded border px-2 py-0.5 text-[10px] transition-colors",
              uiScope === "paper" && !paperDisabled
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background text-muted-foreground hover:bg-muted",
              paperDisabled && "opacity-50 cursor-not-allowed hover:bg-background"
            )}
            aria-pressed={uiScope === "paper" && !paperDisabled}
            title={
              paperDisabled
                ? "Disabled while a highlight is attached"
                : "Search across the entire paper"
            }
          >
            Deep Paper Search
          </button>
          <span
            role="status"
            aria-label="Smart full paper search indicator"
            title="System auto-pulls top supporting chunks from across the paper"
            className={cn(
              "ml-auto inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] transition-colors select-none",
              smartOn
                ? "border-border bg-background text-foreground"
                : "border-border bg-background text-muted-foreground opacity-60"
            )}
          >
            <Sparkles className={cn("size-3", smartOn ? "text-foreground" : "text-muted-foreground")} />
            Smart Full Paper Search
            <span
              className={cn(
                "ml-0.5 inline-block size-1.5 rounded-full",
                smartOn ? "bg-foreground" : "bg-muted-foreground/40"
              )}
              aria-hidden="true"
            />
          </span>
        </div>
      </div>
      {statusBanner && (
        <Alert
          variant={statusBanner.tone === "error" ? "destructive" : "default"}
          className="mx-3 mt-2"
        >
          <AlertDescription>{statusBanner.text}</AlertDescription>
        </Alert>
      )}
      <form onSubmit={handleSubmit} className="p-3 flex gap-2">
        <Input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={docReady ? "Ask about this paper..." : "Chat unavailable until processing completes"}
          disabled={streaming || autoHighlightRunning || !docReady}
          className="text-sm"
        />
        <Button
          type="submit"
          size="sm"
          disabled={streaming || autoHighlightRunning || !input.trim() || !docReady}
        >
          {streaming || autoHighlightRunning ? "..." : "Send"}
        </Button>
      </form>
    </div>
  );
}

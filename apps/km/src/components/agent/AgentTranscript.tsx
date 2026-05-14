"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { useRouter, usePathname } from "next/navigation";
import { resolveCitationTarget } from "@/lib/citation-target";
import { toast } from "sonner";
import {
  agentStreamReducer,
  initialAgentTranscriptState,
  type ErrorCard as ErrorCardData,
  type FileDiffCard as FileDiffCardData,
  type InterruptAction,
  type InterruptCard as InterruptCardData,
  type SkillLoadCard as SkillLoadCardData,
  type SuggestionCard as SuggestionCardData,
  type TextCard as TextCardData,
  type ThinkingCard as ThinkingCardData,
  type ToolCard as ToolCardData,
  type TranscriptCard,
} from "@/lib/agent-stream-reducer";
import type { AgentEvent, Citation } from "@/lib/agent-events";
import type { PageContext } from "@/lib/page-context";
import { useAgentBallOptional } from "./agent-ball-context";

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  AllSourcesList,
  InlineCitationPills,
} from "./CitationsBlock";
import {
  Reasoning,
  ReasoningTrigger,
  ReasoningContent,
} from "@/components/ai-elements/reasoning";
import {
  Tool,
  ToolHeader,
  ToolContent,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import { Suggestions, Suggestion } from "@/components/ai-elements/suggestion";
import {
  Confirmation,
  ConfirmationRequest,
  ConfirmationAccepted,
  ConfirmationRejected,
  ConfirmationActions,
  ConfirmationAction,
} from "@/components/ai-elements/confirmation";
import { Button } from "@/components/ui/button";
import { Shimmer } from "@/components/ai-elements/shimmer";
import {
  Task,
  TaskTrigger,
  TaskContent,
  TaskItem,
} from "@/components/ai-elements/task";
import {
  Alert,
  AlertTitle,
  AlertDescription,
} from "@/components/ui/alert";
import { Textarea } from "@/components/ui/textarea";
import {
  ListChecksIcon,
  ChevronDownIcon,
  AlertTriangleIcon,
  PencilIcon,
} from "lucide-react";
import { FileDiffCard } from "./FileDiffCard";
import { SkillLoadCard } from "./SkillLoadCard";
import { ChatCodePre } from "./ChatCodePre";
import { ChatTable } from "./ChatTable";

// #21 — replace Streamdown's built-in code-block toolbar (copy + download)
// with our own renderer that exposes Copy + Add to library. Tables get a
// matching hover toolbar (Copy as TSV + Download as CSV).
const chatStreamdownComponents = { pre: ChatCodePre, table: ChatTable };

export interface AgentTranscriptProps {
  threadId: string;
  fullHeight?: boolean;
  pageContext?: PageContext;
  onSendMessage?: (text: string) => void;
  onBeforeSendMessage?: (text: string) => void | Promise<void>;
  /** If provided, auto-send this prompt on mount (first render only). */
  initialPrompt?: string | null;
  /** If provided, auto-enable this skill for the first invoke. */
  initialSkill?: string | null;
  /**
   * Task #41 — persisted message-history seed used to hydrate the transcript
   * on mount when reopening an existing thread, so the user doesn't see an
   * empty placeholder. Live streams continue to merge in via the SSE reducer.
   */
  initialMessages?: Array<{
    id: string;
    role: "user" | "assistant";
    text: string;
    parts?: Array<
      | { type: "text"; text: string }
      | {
          type: "tool-call";
          id: string;
          name: string;
          args: Record<string, unknown>;
        }
      | {
          type: "tool-result";
          id: string;
          output?: unknown;
          errorText?: string;
        }
    >;
  }>;
  onPdfExtractProgress?: (progress: { paperId: string; stage: string } | null) => void;
}

// G-R3-07 #78 — same regex used by the live SSE reducer (#64). Some models
// emit a literal "thought" token as the first word of the assistant reply;
// strip it on hydration so historical convos match live-stream rendering.
const stripLeadingThought = (text: string): string =>
  text.replace(/^\s*thought\b[\s:,.\-]*/i, "");

/** #138 — strip empty rows from agent responses.
 *
 *  Prior R5 attempt (`\n{3,}` → `\n\n`) didn't work because a single blank
 *  line (`\n\n`) still renders as an empty row: the MessageResponse wrapper
 *  uses `whitespace-pre-wrap` so literal `\n` characters in markdown text
 *  nodes (between list items, etc.) become visible blank rows, and markdown
 *  treats `\n\n` between bullets as a "loose list" wrapping each `<li>` in a
 *  `<p>` with `my-2` vertical margin. Either path → visible empty row.
 *
 *  Simplest fix per the user's "extremely simple solution to filter empty
 *  rows": collapse every run of newlines down to a single `\n`. Bullets stay
 *  separated (markdown only needs one newline), prose stays readable, and no
 *  blank row can survive. Leading/trailing newlines are also dropped. */
const stripBlankRows = (text: string): string =>
  text
    .replace(/^(?:[ \t]*\n)+/, "")
    .replace(/(?:\n[ \t]*)+$/, "")
    .replace(/(?:[ \t]*\n){2,}/g, "\n");

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
      // Older servers omit actions[]; synthesize so downstream never branches.
      if (data.type === "interrupt" && !Array.isArray(data.actions)) {
        data.actions = [
          {
            tool_call_id: data.id,
            tool: data.tool,
            args: data.args,
            allowed_decisions: data.allowed_decisions,
          },
        ];
      }
      events.push(data as AgentEvent);
    } catch {
      // Drop malformed frame.
    }
  }
  return { events, rest };
}

// Tools that mutate persisted state. After a stream containing any of
// these, call router.refresh() so Server Components on the current page
// (drive view, sidebar tree) re-render with the new data instead of
// requiring a manual reload.
const MUTATING_TOOLS = new Set([
  "create_note",
  "update_note",
  "make_public",
  "edit_file",
  "write_file",
]);

export function AgentTranscript({
  threadId,
  fullHeight = false,
  pageContext,
  onSendMessage,
  onBeforeSendMessage,
  initialPrompt,
  initialSkill,
  initialMessages,
  onPdfExtractProgress,
}: AgentTranscriptProps) {
  const [state, dispatch] = useReducer(
    agentStreamReducer,
    initialAgentTranscriptState,
    (base) => {
      if (!initialMessages || initialMessages.length === 0) return base;
      // G-R3-07 #78 — when a persisted assistant message carries `parts`,
      // expand into one card per part (text + tool) so historical convos
      // mirror the live SSE rendering. Otherwise fall back to a single
      // text card. Either way, strip the model "thought" prefix once.
      const cards: TranscriptCard[] = [];
      for (const m of initialMessages) {
        if (m.parts && m.parts.length > 0) {
          let textIdx = 0;
          for (const part of m.parts) {
            if (part.type === "text") {
              const t = stripLeadingThought(part.text);
              if (!t.trim()) continue;
              cards.push({
                kind: "text",
                id: `${m.id}:t${textIdx++}`,
                role: m.role,
                text: t,
              });
            } else if (part.type === "tool-call") {
              cards.push({
                kind: "tool",
                id: part.id,
                name: part.name,
                args: part.args ?? {},
                state: "input-available",
              });
            } else if (part.type === "tool-result") {
              // Locate the matching tool card and transition its state.
              const existing = [...cards]
                .reverse()
                .find(
                  (c): c is Extract<TranscriptCard, { kind: "tool" }> =>
                    c.kind === "tool" && c.id === part.id,
                );
              if (existing) {
                existing.state = part.errorText
                  ? "output-error"
                  : "output-available";
                existing.output = part.output;
                existing.errorText = part.errorText;
              }
            }
          }
          continue;
        }
        const text = stripLeadingThought(m.text);
        if (!text.trim()) continue;
        cards.push({
          kind: "text",
          id: m.id,
          role: m.role,
          text,
        });
      }
      return { ...base, cards };
    },
  );
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const agentBall = useAgentBallOptional();
  useEffect(() => {
    agentBall?.setWorking(streaming);
  }, [streaming, agentBall]);
  useEffect(() => {
    onPdfExtractProgress?.(state.pdfExtractProgress ?? null);
  }, [onPdfExtractProgress, state.pdfExtractProgress]);
  const abortRef = useRef<AbortController | null>(null);
  const initialPromptSent = useRef(false);
  const defaultSendRef = useRef<((text: string) => Promise<void>) | null>(null);
  const initialSkillRef = useRef(initialSkill);
  const router = useRouter();
  const pathname = usePathname();

  const defaultSend = useCallback(
    async (text: string) => {
      await onBeforeSendMessage?.(text);
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      dispatch({
        type: "__user_message",
        id: `u-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        text,
      });
      setStreaming(true);
      const skill = initialSkillRef.current;
      initialSkillRef.current = null;
      try {
        const res = await fetch("/api/agents/km/invoke", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            thread_id: threadId,
            message: text,
            page_context: pageContext ?? {},
            ...(skill ? { skill } : {}),
          }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          toast.error(
            `Agent request failed (${res.status}). Please try again.`,
          );
          setStreaming(false);
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let mutated = false;
        // G1: track whether we saw a proper SSE `done` frame before the
        // reader closes so we can surface an unexpected-EOF toast.
        let sawDone = false;
        // 60s idle watchdog: TCP can die silently (Mac sleep, NAT timeout) and
        // reader.read() will hang forever. Race each read against a timeout
        // so we surface a stalled stream instead of the spinner running
        // indefinitely.
        while (true) {
          const READ_TIMEOUT_MS = 60_000;
          let timeoutId: ReturnType<typeof setTimeout> | null = null;
          const timeout = new Promise<{ stalled: true }>((resolve) => {
            timeoutId = setTimeout(() => resolve({ stalled: true }), READ_TIMEOUT_MS);
          });
          let result: { stalled: true } | ReadableStreamReadResult<Uint8Array>;
          try {
            result = await Promise.race([reader.read(), timeout]);
          } finally {
            if (timeoutId) clearTimeout(timeoutId);
          }
          if ("stalled" in result) {
            try {
              await reader.cancel();
            } catch {
              // ignore
            }
            toast.error("Agent stream stalled. Try again or refresh.");
            break;
          }
          const { value, done } = result;
          if (done) {
            // G1: clean EOF without a `done` frame — sweep stuck tool cards
            // and show a toast so the user knows to retry.
            if (!sawDone) {
              dispatch({ type: "done", thread_id: "" });
              toast.error("Connection ended unexpectedly — retry?");
            }
            break;
          }
          buf += decoder.decode(value, { stream: true });
          const { events, rest } = parseSseChunk(buf);
          buf = rest;
          for (const ev of events) {
            if (ev.type === "tool_call" && MUTATING_TOOLS.has(ev.name)) {
              mutated = true;
            }
            if (ev.type === "done") {
              sawDone = true;
            }
            dispatch(ev);
          }
        }
        if (mutated) router.refresh();
      } catch {
        // Aborted or network — silent for MVP.
      } finally {
        setStreaming(false);
        onPdfExtractProgress?.(null);
      }
    },
    [threadId, pageContext, router, onPdfExtractProgress, onBeforeSendMessage],
  );

  // Sleep/wake recovery: when tab becomes visible after long hide, abort any
  // in-flight reader. The TCP connection is likely dead but reader.read() may
  // not have ticked the watchdog yet. Aborting clears the spinner immediately.
  useEffect(() => {
    let hiddenAt = 0;
    const onVis = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      const hiddenMs = hiddenAt ? Date.now() - hiddenAt : 0;
      hiddenAt = 0;
      if (hiddenMs > 30_000 && abortRef.current) {
        abortRef.current.abort();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // Keep ref in sync so the auto-send effect can access it without TDZ
  defaultSendRef.current = defaultSend;

  // Auto-send initial prompt on first mount (once only)
  useEffect(() => {
    if (initialPrompt && !initialPromptSent.current) {
      initialPromptSent.current = true;
      const text = initialPrompt;
      requestAnimationFrame(() => {
        if (onSendMessage) onSendMessage(text);
        else void defaultSendRef.current?.(text);
      });
    }
  }, [initialPrompt, onSendMessage]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // #25 — focus prompt textarea on every mount/open transition. The parent
  // (AgentBall) keys the AgentTranscript on threadId, so on every re-open with
  // a fresh thread this effect re-runs. requestAnimationFrame defers until
  // after the panel transitions in, avoiding browser focus-loss on layout.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, []);

  const handleSend = useCallback(
    (textArg?: string) => {
      const text = (textArg ?? input).trim();
      if (!text) return;
      if (textArg === undefined) setInput("");
      if (onSendMessage) onSendMessage(text);
      else void defaultSend(text);
    },
    [input, onSendMessage, defaultSend],
  );

  // Task #45: fork conversation at a prior user message. Truncates the
  // transcript to drop the original message and everything after it, then
  // re-invokes with the edited prompt. Server-side: deep-agents checkpointer
  // doesn't support targeted message-history truncation cheaply, so the
  // minimum-viable approach is to forward to /api/agents/km/invoke (same
  // thread) — the agent continues from the new user turn. Operators who need
  // exact server-side truncation can later swap this for a dedicated
  // /api/agents/km/fork endpoint with the same payload shape.
  const handleForkSubmit = useCallback(
    (messageId: string, editedText: string) => {
      const text = editedText.trim();
      if (!text) return;
      dispatch({ type: "__fork_at", messageId });
      if (onSendMessage) onSendMessage(text);
      else void defaultSend(text);
    },
    [onSendMessage, defaultSend],
  );

  const sendDecision = useCallback(
    async (
      _cardId: string,
      type: "approve" | "reject" | "edit",
      actions: InterruptAction[],
      editedAction?: { name: string; args: Record<string, unknown> },
    ): Promise<boolean> => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      dispatch({ type: "__resume" });
      setStreaming(true);
      // POST N decisions so langchain HITL middleware's count matches the
      // N hanging tool calls bundled into this interrupt.
      const decisions =
        type === "edit" && editedAction && actions.length === 1
          ? [
              {
                tool_call_id: actions[0].toolCallId,
                type: "edit" as const,
                edited_action: editedAction,
              },
            ]
          : actions.map((a) => ({
              tool_call_id: a.toolCallId,
              type: type as "approve" | "reject",
            }));
      try {
        const res = await fetch("/api/agents/km/resume", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            thread_id: threadId,
            decisions,
          }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          setStreaming(false);
          return false;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let mutated = false;
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const { events, rest } = parseSseChunk(buf);
          buf = rest;
          for (const ev of events) {
            if (ev.type === "tool_call" && MUTATING_TOOLS.has(ev.name)) {
              mutated = true;
            }
            dispatch(ev);
          }
        }
        if (mutated) router.refresh();
        return true;
      } catch {
        return false;
      } finally {
        setStreaming(false);
        onPdfExtractProgress?.(null);
      }
    },
    [threadId, router, onPdfExtractProgress],
  );

  const handleSuggestionClick = useCallback(
    (suggestion: string) => {
      handleSend(suggestion);
    },
    [handleSend],
  );

  const allCitations = useMemo<Citation[]>(() => {
    const out: Citation[] = [];
    for (const list of Object.values(state.sourcesByMessage)) {
      out.push(...list);
    }
    return out;
  }, [state.sourcesByMessage]);

  const handleCitationClick = useCallback(
    (citation: Citation) => {
      const paperId = citation.paperId ?? citation.paper_id;
      if (!paperId) return;
      const page = citation.page && citation.page > 0 ? citation.page : 1;
      const bbox = citation.bbox
        ? `${citation.bbox.x0},${citation.bbox.y0},${citation.bbox.x1},${citation.bbox.y1}`
        : null;
      const chunkId = citation.chunkId ?? citation.chunk_id ?? null;
      // B7 — when the transcript is mounted inside the reader, scroll the
      // existing reader in place via the `episteme:reader-jump` window event
      // (Reader.tsx listens for it). Navigating to /p/{id} or even /papers/
      // {id}/read would unmount the reader, killing the chat panel mid-flow.
      //
      // R6 B4 — extend the detail with the structured bbox + parsed
      // orderIndex so Reader can scroll-to-segment and pulse a highlight,
      // not just jump to the right page.
      const target = resolveCitationTarget({
        pathname,
        paperId,
        page,
        bbox,
        chunkId,
      });
      if (target.kind === "in-place") {
        window.dispatchEvent(
          new CustomEvent("episteme:reader-jump", {
            detail: {
              page: target.page,
              bbox: target.bbox,
              chunkId: target.chunkId,
              orderIndex: target.orderIndex,
              bboxRect: citation.bbox ?? null,
            },
          }),
        );
        return;
      }
      router.push(target.url);
    },
    [router, pathname],
  );

  return (
    <div
      className={`flex flex-col ${fullHeight ? "h-full" : "h-[520px]"}`}
      data-testid="agent-transcript"
    >
      <Conversation className="flex-1 min-h-0">
        <ConversationContent className="gap-3 text-sm leading-snug [&_p]:my-1">
          {state.cards.length === 0 ? (
            <div className="text-muted-foreground text-xs">
              No messages yet. Ask the agent something.
            </div>
          ) : (
            state.cards.map((card, i) => (
              <CardView
                key={`${card.kind}-${"id" in card ? card.id : i}-${i}`}
                card={card}
                streaming={streaming}
                onSuggestionClick={handleSuggestionClick}
                threadId={threadId}
                onDecision={sendDecision}
                onForkSubmit={handleForkSubmit}
                citationsByMessage={state.sourcesByMessage}
                onCitationClick={handleCitationClick}
              />
            ))
          )}
          {state.todos.length > 0 ? (
            <div data-testid="todo-list">
              <Task>
                <TaskTrigger title={`Plan · ${state.todos.length} todos`}>
                  <div className="flex w-full cursor-pointer items-center gap-2 text-muted-foreground text-sm transition-colors hover:text-foreground">
                    <ListChecksIcon className="size-4" />
                    <p className="text-sm" data-testid="todo-count">
                      Plan · {state.todos.length} todos
                    </p>
                    <ChevronDownIcon className="size-4 transition-transform group-data-[state=open]:rotate-180" />
                  </div>
                </TaskTrigger>
                <TaskContent>
                  {state.todos.map((t, idx) => {
                    const marker =
                      t.status === "completed"
                        ? "[x]"
                        : t.status === "in_progress"
                          ? "[~]"
                          : "[ ]";
                    return (
                      <TaskItem
                        key={t.id ?? `todo-${idx}`}
                        data-status={t.status}
                        className={
                          t.status === "completed"
                            ? "line-through opacity-60"
                            : t.status === "in_progress"
                              ? "text-foreground font-medium"
                              : ""
                        }
                      >
                        <span className="font-mono mr-2">{marker}</span>
                        {t.content}
                      </TaskItem>
                    );
                  })}
                </TaskContent>
              </Task>
            </div>
          ) : null}
          {allCitations.length > 0 ? (
            <AllSourcesList citations={allCitations} />
          ) : null}
          {streaming ? (
            <div
              data-testid="streaming-indicator"
              className="flex items-center gap-2"
            >
              <Shimmer duration={1}>Thinking…</Shimmer>
            </div>
          ) : null}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
      <div className="border-t p-2 flex items-center gap-2">
        <Textarea
          ref={inputRef}
          autoFocus
          className="min-h-9 max-h-48 resize-none py-1.5 text-sm"
          placeholder="Ask anything"
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
          onClick={() => handleSend()}
          disabled={!input.trim() || streaming}
          className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </div>
  );
}

interface CardViewProps {
  card: TranscriptCard;
  streaming: boolean;
  onSuggestionClick: (suggestion: string) => void;
  threadId: string;
  onDecision: (
    cardId: string,
    type: "approve" | "reject" | "edit",
    actions: InterruptAction[],
    editedAction?: { name: string; args: Record<string, unknown> },
  ) => Promise<boolean>;
  onForkSubmit: (messageId: string, editedText: string) => void;
  citationsByMessage: Record<string, Citation[]>;
  onCitationClick: (citation: Citation) => void;
}

function CardView({
  card,
  streaming,
  onSuggestionClick,
  threadId,
  onDecision,
  onForkSubmit,
  citationsByMessage,
  onCitationClick,
}: CardViewProps) {
  switch (card.kind) {
    case "text":
      return (
        <TextCardView
          card={card}
          onForkSubmit={onForkSubmit}
          citations={card.role === "assistant" ? citationsByMessage[card.id] ?? [] : []}
          onCitationClick={onCitationClick}
        />
      );
    case "thinking":
      return <ThinkingCardView card={card} streaming={streaming} />;
    case "tool":
      return <ToolCardView card={card} />;
    case "interrupt":
      return <InterruptCardView card={card} threadId={threadId} onDecision={onDecision} />;
    case "skill_load":
      return <SkillLoadCard name={card.name} />;
    case "file_diff":
      return <FileDiffCardView card={card} />;
    case "suggestion":
      return <SuggestionCardView card={card} onClick={onSuggestionClick} />;
    case "error":
      return <ErrorCardView card={card} />;
    default: {
      const _: never = card;
      void _;
      return null;
    }
  }
}

function TextCardView({
  card,
  onForkSubmit,
  citations,
  onCitationClick,
}: {
  card: TextCardData;
  onForkSubmit: (messageId: string, editedText: string) => void;
  citations: Citation[];
  onCitationClick: (citation: Citation) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(card.text);
  const isUser = card.role === "user";

  if (editing && isUser) {
    return (
      <div data-testid="card-text" data-role={card.role} className="group relative">
        <div className="flex flex-col gap-2 rounded-md border bg-muted/30 p-2">
          <Textarea
            aria-label="Edit user message"
            className="min-h-9 max-h-48 resize-none py-1.5 text-sm"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onForkSubmit(card.id, draft);
                setEditing(false);
              } else if (e.key === "Escape") {
                setDraft(card.text);
                setEditing(false);
              }
            }}
            rows={1}
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setDraft(card.text);
                setEditing(false);
              }}
              className="rounded px-2 py-1 text-xs hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                onForkSubmit(card.id, draft);
                setEditing(false);
              }}
              aria-label="Submit edit"
              className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground"
            >
              Submit edit
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="card-text" data-role={card.role} className="group flex flex-col">
      <Message from={card.role}>
        <MessageContent>
          {/* RG3 #58 — assistant prose paragraphs use leading-snug (1.375); user bubble inherits. */}
          <MessageResponse
            className={card.role === "assistant" ? "[&_p]:leading-snug" : undefined}
            controls={false}
            components={chatStreamdownComponents}
          >
            {stripBlankRows(card.text)}
          </MessageResponse>
        </MessageContent>
      </Message>
      {card.role === "assistant" && citations.length > 0 ? (
        <InlineCitationPills citations={citations} onCitationClick={onCitationClick} />
      ) : null}
      {isUser ? (
        <button
          type="button"
          aria-label="Edit message"
          onClick={() => {
            setDraft(card.text);
            setEditing(true);
          }}
          className="mt-1 self-end rounded p-1 opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100"
        >
          <PencilIcon className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}

function ThinkingCardView({
  card,
  streaming,
}: {
  card: ThinkingCardData;
  streaming: boolean;
}) {
  return (
    <div data-testid="card-thinking">
      <Reasoning isStreaming={streaming}>
        <ReasoningTrigger />
        <ReasoningContent>{card.text}</ReasoningContent>
      </Reasoning>
    </div>
  );
}

// Memory-op detection: deep-agents FilesystemMiddleware exposes ls/read_file/
// write_file/edit_file/glob/grep. Memory writes/reads are routed via
// CompositeBackend on paths under `/memories/` (see services/agents/store.py
// and backends/memories_backend.py). Surface a small "Recalling/Saving memory"
// pill instead of the full tool box for these.
const MEMORY_READ_TOOLS = new Set(["read_file", "ls", "glob", "grep"]);
const MEMORY_WRITE_TOOLS = new Set(["write_file", "edit_file"]);

function memoryOpKind(card: ToolCardData): "read" | "write" | null {
  const path =
    typeof card.args?.file_path === "string"
      ? (card.args.file_path as string)
      : typeof card.args?.path === "string"
        ? (card.args.path as string)
        : "";
  if (!path.startsWith("/memories/") && path !== "/memories" && path !== "/memories/")
    return null;
  if (MEMORY_WRITE_TOOLS.has(card.name)) return "write";
  if (MEMORY_READ_TOOLS.has(card.name)) return "read";
  return null;
}

function ToolCardView({ card }: { card: ToolCardData }) {
  const memKind = memoryOpKind(card);
  if (memKind) {
    const inProgress = card.state === "input-available";
    const label =
      memKind === "write"
        ? inProgress
          ? "Saving memory…"
          : "Saved memory"
        : inProgress
          ? "Recalling memory…"
          : "Recalled memory";
    return (
      <div data-testid="card-tool" data-memory-op={memKind}>
        <Task defaultOpen={false}>
          <TaskTrigger title={label} />
          <TaskContent>
            <ToolInput input={card.args} />
            <ToolOutput output={card.output} errorText={card.errorText} />
          </TaskContent>
        </Task>
      </div>
    );
  }
  return (
    <div data-testid="card-tool">
      <Tool defaultOpen={false}>
        <ToolHeader
          type={`tool-${card.name}` as `tool-${string}`}
          state={card.state}
        />
        <ToolContent>
          <ToolInput input={card.args} />
          <ToolOutput output={card.output} errorText={card.errorText} />
        </ToolContent>
      </Tool>
    </div>
  );
}

function FileDiffCardView({ card }: { card: FileDiffCardData }) {
  return (
    <FileDiffCard
      noteId={card.noteId}
      beforeHash={card.beforeHash}
      afterHash={card.afterHash}
      diff={card.diff}
    />
  );
}

function ErrorCardView({ card }: { card: ErrorCardData }) {
  return (
    <Alert variant="destructive" data-testid="card-error">
      <AlertTriangleIcon className="h-4 w-4" />
      <AlertTitle>
        {card.code === "rate_limited" ? "Rate limited" : "Error"}
      </AlertTitle>
      <AlertDescription>
        {card.message}
        {card.retriable ? (
          <div className="mt-2 text-xs">You can try again in a moment.</div>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

function SuggestionCardView({
  card,
  onClick,
}: {
  card: SuggestionCardData;
  onClick: (suggestion: string) => void;
}) {
  return (
    <div data-testid="card-suggestion">
      <Suggestions>
        {card.items.map((item, i) => (
          <Suggestion
            key={`${item}-${i}`}
            suggestion={item}
            onClick={onClick}
          />
        ))}
      </Suggestions>
    </div>
  );
}

interface InterruptCardViewProps {
  card: InterruptCardData;
  threadId: string;
  onDecision: (
    cardId: string,
    type: "approve" | "reject" | "edit",
    actions: InterruptAction[],
    editedAction?: { name: string; args: Record<string, unknown> },
  ) => Promise<boolean>;
}

function InterruptCardView({ card, onDecision }: InterruptCardViewProps) {
  const [decided, setDecided] = useState<"approve" | "reject" | "edit" | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const isBatch = card.actions.length > 1;

  // Edit state — only relevant for N=1
  const [editOpen, setEditOpen] = useState(false);
  const originalArgsJson = JSON.stringify(card.actions[0]?.args ?? {}, null, 2);
  const [editDraft, setEditDraft] = useState(originalArgsJson);
  const [editParseError, setEditParseError] = useState<string | null>(null);
  const editTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Autofocus the textarea when edit panel opens
  useEffect(() => {
    if (editOpen) {
      editTextareaRef.current?.focus();
    }
  }, [editOpen]);

  const handleEditChange = useCallback((val: string) => {
    setEditDraft(val);
    try {
      const parsed: unknown = JSON.parse(val);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        setEditParseError("args must be a JSON object");
      } else {
        setEditParseError(null);
      }
    } catch {
      setEditParseError("Invalid JSON");
    }
  }, []);

  const handleEditSave = useCallback(async () => {
    if (editParseError || submitting || decided) return;
    let parsed: Record<string, unknown>;
    try {
      const raw: unknown = JSON.parse(editDraft);
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        setEditParseError("args must be a JSON object");
        return;
      }
      parsed = raw as Record<string, unknown>;
    } catch {
      setEditParseError("Invalid JSON");
      return;
    }
    setSubmitting(true);
    setDecided("edit");
    const ok = await onDecision(card.id, "edit", card.actions, {
      name: card.actions[0].tool,
      args: parsed,
    });
    if (!ok) {
      setDecided(null);
      toast.error("Failed to send decision. Try again.");
    }
    setSubmitting(false);
  }, [editParseError, submitting, decided, editDraft, onDecision, card]);

  const decide = useCallback(
    async (type: "approve" | "reject") => {
      if (decided || submitting) return;
      setSubmitting(true);
      setDecided(type);
      const ok = await onDecision(card.id, type, card.actions);
      if (!ok) {
        setDecided(null);
        toast.error("Failed to send decision. Try again.");
      }
      setSubmitting(false);
    },
    [card.id, card.actions, onDecision, decided, submitting],
  );

  // Confirmation is driven from our local reducer/interrupt state, not the AI
  // SDK runtime. We map our pre/post-decision flags onto the AI SDK shape:
  //   undecided  → state="approval-requested", approval={id}
  //   approve    → state="approval-responded", approval={id, approved:true}
  //   reject     → state="output-denied",      approval={id, approved:false}
  //   edit       → treat as "approved" for display purposes
  const approval =
    decided === null || decided === "edit"
      ? decided === "edit"
        ? { id: card.id, approved: true }
        : { id: card.id }
      : { id: card.id, approved: decided === "approve" };
  const confState: "approval-requested" | "approval-responded" | "output-denied" =
    decided === null
      ? "approval-requested"
      : decided === "approve" || decided === "edit"
        ? "approval-responded"
        : "output-denied";

  return (
    <div data-testid="card-interrupt">
      <Confirmation approval={approval} state={confState}>
        <ConfirmationRequest>
          {isBatch ? (
            <div className="space-y-2 text-xs">
              <div className="font-medium">
                Approve {card.actions.length}{" "}
                <span className="font-mono">{card.tool}</span> calls from this turn
              </div>
              <details className="text-[11px]">
                <summary className="cursor-pointer text-muted-foreground">
                  Show all {card.actions.length} calls
                </summary>
                <ul className="mt-1 space-y-1">
                  {card.actions.map((a, i) => (
                    <li
                      key={a.toolCallId || `${a.tool}-${i}`}
                      data-testid="interrupt-action"
                    >
                      <pre className="whitespace-pre-wrap break-words font-mono rounded bg-muted/40 p-2 max-h-32 overflow-auto">
                        {JSON.stringify(a.args, null, 2)}
                      </pre>
                    </li>
                  ))}
                </ul>
              </details>
            </div>
          ) : (
            <div className="space-y-2 text-xs">
              <div className="font-medium">
                Approval required: <span className="font-mono">{card.tool}</span>
              </div>
              <pre className="whitespace-pre-wrap break-words font-mono text-[11px] rounded bg-muted/40 p-2 max-h-48 overflow-auto">
                {JSON.stringify(card.args, null, 2)}
              </pre>
              {editOpen && (
                <div className="mt-2 space-y-1.5" data-testid="interrupt-edit-panel">
                  <Textarea
                    ref={editTextareaRef}
                    aria-label="Edit action args"
                    className="min-h-24 resize-y font-mono text-[11px]"
                    value={editDraft}
                    onChange={(e) => handleEditChange(e.target.value)}
                    spellCheck={false}
                  />
                  {editParseError && (
                    <p className="text-sm text-destructive" data-testid="interrupt-edit-error">
                      {editParseError}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => {
                        setEditOpen(false);
                        setEditDraft(originalArgsJson);
                        setEditParseError(null);
                      }}
                      disabled={submitting}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="xs"
                      onClick={handleEditSave}
                      disabled={!!editParseError || submitting}
                      data-testid="interrupt-edit-save"
                    >
                      Save
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </ConfirmationRequest>
        <ConfirmationAccepted>
          <span data-testid="interrupt-decided">
            {decided === "edit" ? "Edited & approved" : "Approved"}
          </span>
        </ConfirmationAccepted>
        <ConfirmationRejected>
          <span data-testid="interrupt-decided">Rejected</span>
        </ConfirmationRejected>
        <ConfirmationActions>
          {!isBatch && (
            <ConfirmationAction
              variant="outline"
              data-action="edit"
              disabled={submitting}
              onClick={() => setEditOpen((o) => !o)}
            >
              Edit
            </ConfirmationAction>
          )}
          <ConfirmationAction
            variant="outline"
            data-action="reject"
            disabled={submitting}
            onClick={() => decide("reject")}
          >
            Reject
          </ConfirmationAction>
          <ConfirmationAction
            data-action="approve"
            disabled={submitting}
            onClick={() => decide("approve")}
          >
            Approve
          </ConfirmationAction>
        </ConfirmationActions>
      </Confirmation>
    </div>
  );
}

"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  agentStreamReducer,
  initialAgentTranscriptState,
  type ErrorCard as ErrorCardData,
  type FileDiffCard as FileDiffCardData,
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
  Sources,
  SourcesTrigger,
  SourcesContent,
  Source,
} from "@/components/ai-elements/sources";
import {
  Confirmation,
  ConfirmationRequest,
  ConfirmationAccepted,
  ConfirmationRejected,
  ConfirmationActions,
  ConfirmationAction,
} from "@/components/ai-elements/confirmation";
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
import {
  ListChecksIcon,
  ChevronDownIcon,
  AlertTriangleIcon,
} from "lucide-react";
import { FileDiffCard } from "./FileDiffCard";
import { SkillLoadCard } from "./SkillLoadCard";

export interface AgentTranscriptProps {
  threadId: string;
  fullHeight?: boolean;
  pageContext?: PageContext;
  onSendMessage?: (text: string) => void;
  /** If provided, auto-send this prompt on mount (first render only). */
  initialPrompt?: string | null;
  /** If provided, auto-enable this skill for the first invoke. */
  initialSkill?: string | null;
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
  initialPrompt,
  initialSkill,
}: AgentTranscriptProps) {
  const [state, dispatch] = useReducer(
    agentStreamReducer,
    initialAgentTranscriptState,
  );
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const initialPromptSent = useRef(false);
  const defaultSendRef = useRef<((text: string) => Promise<void>) | null>(null);
  const initialSkillRef = useRef(initialSkill);
  const router = useRouter();

  const defaultSend = useCallback(
    async (text: string) => {
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
      } catch {
        // Aborted or network — silent for MVP.
      } finally {
        setStreaming(false);
      }
    },
    [threadId, pageContext, router],
  );

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

  const sendDecision = useCallback(
    async (cardId: string, type: "approve" | "reject"): Promise<boolean> => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      dispatch({ type: "__resume" });
      setStreaming(true);
      try {
        const res = await fetch("/api/agents/km/resume", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            thread_id: threadId,
            decisions: [{ tool_call_id: cardId, type }],
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
      }
    },
    [threadId, router],
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

  return (
    <div
      className={`flex flex-col ${fullHeight ? "h-full" : "h-[520px]"}`}
      data-testid="agent-transcript"
    >
      <Conversation className="flex-1 min-h-0">
        <ConversationContent className="text-sm">
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
            <div data-testid="all-citations">
              <Sources>
                <SourcesTrigger count={allCitations.length} />
                <SourcesContent>
                  {allCitations.map((c, i) => (
                    <Source
                      key={`${c.chunk_id}-${i}`}
                      href={c.url ?? "#"}
                      title={`${c.title ?? c.chunk_id}${
                        c.page ? ` · p${c.page}` : ""
                      }`}
                    />
                  ))}
                </SourcesContent>
              </Sources>
            </div>
          ) : null}
          {streaming ? (
            <div
              data-testid="streaming-indicator"
              className="flex items-center gap-2"
            >
              <Shimmer duration={1}>Thinking…</Shimmer>
              {state.recursionStep !== undefined ? (
                <span
                  data-testid="recursion-step"
                  className="text-xs text-muted-foreground"
                >
                  step {state.recursionStep} / 100
                </span>
              ) : null}
            </div>
          ) : null}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
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
          onClick={() => handleSend()}
          disabled={!input.trim() || streaming}
          className="rounded-md bg-primary px-3 py-1 text-sm text-primary-foreground disabled:opacity-50"
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
  onDecision: (cardId: string, type: "approve" | "reject") => Promise<boolean>;
}

function CardView({
  card,
  streaming,
  onSuggestionClick,
  threadId,
  onDecision,
}: CardViewProps) {
  switch (card.kind) {
    case "text":
      return <TextCardView card={card} />;
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

function TextCardView({ card }: { card: TextCardData }) {
  return (
    <div data-testid="card-text" data-role={card.role}>
      <Message from={card.role}>
        <MessageContent>
          <MessageResponse>{card.text}</MessageResponse>
        </MessageContent>
      </Message>
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

function ToolCardView({ card }: { card: ToolCardData }) {
  return (
    <div data-testid="card-tool">
      <Tool defaultOpen>
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
  onDecision: (cardId: string, type: "approve" | "reject") => Promise<boolean>;
}

function InterruptCardView({ card, onDecision }: InterruptCardViewProps) {
  const [decided, setDecided] = useState<"approve" | "reject" | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const decide = useCallback(
    async (type: "approve" | "reject") => {
      if (decided || submitting) return;
      setSubmitting(true);
      setDecided(type);
      const ok = await onDecision(card.id, type);
      if (!ok) {
        setDecided(null);
        toast.error("Failed to send decision. Try again.");
      }
      setSubmitting(false);
    },
    [card.id, onDecision, decided, submitting],
  );

  // Confirmation is driven from our local reducer/interrupt state, not the AI
  // SDK runtime. We map our pre/post-decision flags onto the AI SDK shape:
  //   undecided  → state="approval-requested", approval={id}
  //   approve    → state="approval-responded", approval={id, approved:true}
  //   reject     → state="output-denied",      approval={id, approved:false}
  const approval =
    decided === null
      ? { id: card.id }
      : { id: card.id, approved: decided === "approve" };
  const confState: "approval-requested" | "approval-responded" | "output-denied" =
    decided === null
      ? "approval-requested"
      : decided === "approve"
        ? "approval-responded"
        : "output-denied";

  return (
    <div data-testid="card-interrupt">
      <Confirmation approval={approval} state={confState}>
        <ConfirmationRequest>
          <div className="space-y-2 text-xs">
            <div className="font-medium">
              Approval required: <span className="font-mono">{card.tool}</span>
            </div>
            <pre className="whitespace-pre-wrap break-words font-mono text-[11px] rounded bg-muted/40 p-2 max-h-48 overflow-auto">
              {JSON.stringify(card.args, null, 2)}
            </pre>
          </div>
        </ConfirmationRequest>
        <ConfirmationAccepted>
          <span data-testid="interrupt-decided">Approved</span>
        </ConfirmationAccepted>
        <ConfirmationRejected>
          <span data-testid="interrupt-decided">Rejected</span>
        </ConfirmationRejected>
        <ConfirmationActions>
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

"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  agentStreamReducer,
  initialAgentTranscriptState,
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
import { FileDiffCard } from "./FileDiffCard";
import { SkillLoadCard } from "./SkillLoadCard";

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
              />
            ))
          )}
          {state.todos.length > 0 ? (
            <div className="text-xs text-muted-foreground" data-testid="todo-count">
              {state.todos.length} todos
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
            <div className="text-muted-foreground text-xs" data-testid="streaming-indicator">
              …
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
}

function CardView({
  card,
  streaming,
  onSuggestionClick,
  threadId,
}: CardViewProps) {
  switch (card.kind) {
    case "text":
      return <TextCardView card={card} />;
    case "thinking":
      return <ThinkingCardView card={card} streaming={streaming} />;
    case "tool":
      return <ToolCardView card={card} />;
    case "interrupt":
      return <InterruptCardView card={card} threadId={threadId} />;
    case "skill_load":
      return <SkillLoadCard name={card.name} />;
    case "file_diff":
      return <FileDiffCardView card={card} />;
    case "suggestion":
      return <SuggestionCardView card={card} onClick={onSuggestionClick} />;
    default: {
      const _: never = card;
      void _;
      return null;
    }
  }
}

function TextCardView({ card }: { card: TextCardData }) {
  return (
    <div data-testid="card-text">
      <Message from="assistant">
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
      <Tool defaultOpen={card.state !== "input-available"}>
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
}

function InterruptCardView({ card, threadId }: InterruptCardViewProps) {
  const [decided, setDecided] = useState<"approve" | "reject" | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const decide = useCallback(
    async (type: "approve" | "reject") => {
      if (decided || submitting) return;
      setSubmitting(true);
      try {
        await fetch("/api/agents/km/resume", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            thread_id: threadId,
            decisions: [{ tool_call_id: card.id, type }],
          }),
        });
        setDecided(type);
      } catch {
        // surface to UI later; MVP swallow.
      } finally {
        setSubmitting(false);
      }
    },
    [card.id, threadId, decided, submitting],
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

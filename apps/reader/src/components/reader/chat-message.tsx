"use client";

import type { ChatAttachment, ChatMessageKind } from "@/hooks/use-chat";

interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
  attachment?: ChatAttachment;
  kind?: ChatMessageKind;
  progressSteps?: string[];
  highlightsCount?: number;
  runId?: string;
  onReviewHighlights?: (runId: string) => void;
}

export function ChatMessage({
  role,
  content,
  isStreaming = false,
  attachment,
  kind = "chat",
  progressSteps,
  highlightsCount,
  runId,
  onReviewHighlights,
}: ChatMessageProps) {
  const isProgress = kind === "auto-highlight-progress";
  const isResult = kind === "auto-highlight-result";
  const showReview =
    role === "assistant" &&
    !!runId &&
    typeof highlightsCount === "number" &&
    highlightsCount > 0 &&
    !!onReviewHighlights;
  return (
    <div className={`flex ${role === "user" ? "justify-end" : "justify-start"} mb-3`}>
      <div
        className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
          role === "user"
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-muted-foreground"
        }`}
      >
        {attachment && role === "user" && (
          <div className="mb-1.5 rounded border-l-2 border-primary-foreground/40 bg-primary-foreground/10 px-2 py-1">
            <p className="text-[10px] font-medium opacity-80">
              Highlighted · Page {attachment.pageNumber}
            </p>
            <p className="line-clamp-2 text-xs italic opacity-90">
              “{attachment.text}”
            </p>
          </div>
        )}
        {isProgress ? (
          <div>
            <p className="mb-1 text-[10px] font-medium uppercase tracking-wide opacity-70">
              Auto-highlight
            </p>
            {content && <p className="mb-1 whitespace-pre-wrap">{content}</p>}
            {progressSteps && progressSteps.length > 0 && (
              <ul className="space-y-0.5 text-xs">
                {progressSteps.map((s, i) => (
                  <li key={i}>• {s}</li>
                ))}
              </ul>
            )}
            {isStreaming && <span className="animate-pulse">▋</span>}
          </div>
        ) : (
          <>
            {isResult && (
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wide opacity-70">
                Auto-highlight{" "}
                {typeof highlightsCount === "number" && `· ${highlightsCount} highlight${highlightsCount === 1 ? "" : "s"}`}
              </p>
            )}
            <p className="whitespace-pre-wrap">{content}</p>
            {isStreaming && <span className="animate-pulse">▋</span>}
            {showReview && (
              <button
                type="button"
                onClick={() => onReviewHighlights!(runId!)}
                className="mt-1.5 inline-flex items-center rounded border border-border bg-background px-2 py-0.5 text-[11px] font-medium text-foreground hover:bg-muted"
              >
                Review highlights
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

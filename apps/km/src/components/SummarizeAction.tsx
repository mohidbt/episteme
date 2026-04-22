"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SparklesIcon } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { runSlashAi } from "@/app/(app)/n/[slug]/run-slash-ai";

const SUMMARIZE_PROMPT = "Summarize this note in 3 short sentences.";

type Status = "idle" | "streaming" | "done" | "error";

export function SummarizeAction({
  noteId,
  contentMd,
  onBeforeInsert,
  onAfterInsert,
}: {
  noteId: string;
  contentMd: string;
  onBeforeInsert?: () => Promise<void> | void;
  onAfterInsert?: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [summary, setSummary] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isInserting, setIsInserting] = useState(false);
  const [insertError, setInsertError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const contentMdRef = useRef(contentMd);

  // When panel opens, fire the stream.
  useEffect(() => {
    if (!isOpen) {
      // Cancel any in-flight stream when panel closes.
      abortRef.current?.abort();
      abortRef.current = null;
      return;
    }

    // Freeze contentMd at open-time so parent re-renders don't restart stream.
    contentMdRef.current = contentMd;
    const controller = new AbortController();
    abortRef.current = controller;
    setSummary("");
    setStatus("streaming");
    setErrorMsg(null);
    setInsertError(null);

    void runSlashAi({
      prompt: SUMMARIZE_PROMPT,
      context: contentMdRef.current,
      signal: controller.signal,
      onToken: (chunk) => {
        setSummary((prev) => prev + chunk);
      },
      onError: (msg) => {
        setErrorMsg(msg);
        setStatus("error");
      },
    }).then(() => {
      // If we never flipped to error, we're done.
      setStatus((s) => (s === "error" ? s : "done"));
    });

    return () => {
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const canInsert = status === "done" && summary.trim().length > 0 && !isInserting;

  const handleCopy = useCallback(async () => {
    await navigator.clipboard?.writeText(summary);
    setIsOpen(false);
  }, [summary]);

  const handleInsert = useCallback(
    async (position: "top" | "bottom") => {
      if (!canInsert) return;
      setIsInserting(true);
      setInsertError(null);
      try {
        // 1. Snapshot pre-insert state
        const snap = await fetch(
          `/api/notes/${noteId}/revisions/snapshot?reason=pre-ai-edit`,
          { method: "POST" },
        );
        if (!snap.ok) {
          setInsertError("Failed to snapshot note before insert.");
          return;
        }
        // 2. Flush pending autosave
        await onBeforeInsert?.();
        // 3. Fetch current content
        const getRes = await fetch(`/api/notes/${noteId}`);
        if (!getRes.ok) {
          setInsertError("Failed to fetch current note content.");
          return;
        }
        const note = (await getRes.json()) as { contentMd?: string };
        const current = note.contentMd ?? "";
        // 4. Compose
        const trimmed = summary.trim();
        const body =
          position === "top"
            ? `${trimmed}\n\n${current}`
            : `${current}\n\n${trimmed}`;
        // 5. PATCH
        const patch = await fetch(
          `/api/notes/${noteId}/content?reason=manual`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ contentMd: body }),
          },
        );
        if (!patch.ok) {
          setInsertError("Failed to save inserted summary.");
          return;
        }
        // 6. Refresh + close
        onAfterInsert?.();
        setIsOpen(false);
      } finally {
        setIsInserting(false);
      }
    },
    [canInsert, noteId, onBeforeInsert, onAfterInsert, summary],
  );

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger
        render={
          <Button variant="ghost" size="icon" aria-label="Summarize">
            <SparklesIcon />
          </Button>
        }
      />
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b">
          <SheetTitle>Summarize</SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-auto p-4">
          {status === "streaming" && summary.length === 0 && (
            <div className="text-xs text-muted-foreground">Streaming...</div>
          )}
          <div
            data-testid="summary-text"
            className="whitespace-pre-wrap text-sm text-foreground"
          >
            {summary}
          </div>
          {status === "streaming" && summary.length > 0 && (
            <div className="mt-2 text-xs text-muted-foreground">
              Streaming...
            </div>
          )}
          {status === "error" && (
            <div
              data-testid="summarize-error"
              className="mt-2 text-xs text-destructive"
            >
              Summary failed{errorMsg ? `: ${errorMsg}` : ""}.
            </div>
          )}
        </div>
        {insertError && (
          <div
            data-testid="insert-error"
            className="mx-4 mb-2 text-xs text-destructive"
          >
            {insertError}
          </div>
        )}
        <div className="flex items-center justify-end gap-2 border-t p-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleInsert("top")}
            disabled={!canInsert}
          >
            Insert at top
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleInsert("bottom")}
            disabled={!canInsert}
          >
            Insert at bottom
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={handleCopy}
            disabled={summary.length === 0 || status === "streaming"}
          >
            Copy
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

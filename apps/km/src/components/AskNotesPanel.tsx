"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { MessageSquareIcon } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { runAskNotes, type Source } from "@/lib/ai/run-ask-notes";

type Role = "user" | "assistant";

interface ChatMsg {
  role: Role;
  content: string;
  sources?: Source[];
}

type Status = "idle" | "streaming" | "done" | "error";

export function AskNotesPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Abort in-flight stream when panel closes.
  useEffect(() => {
    if (!isOpen) {
      abortRef.current?.abort();
      abortRef.current = null;
    }
  }, [isOpen]);

  const handleSend = useCallback(() => {
    const question = input.trim();
    if (!question) return;

    // Abort any previous in-flight stream (follow-up mid-stream case).
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // Build history from prior messages (excluding any currently-streaming assistant slot).
    const history = messages.map((m) => ({ role: m.role, content: m.content }));

    // Push user + empty assistant slot; remember assistant index.
    const assistantIndex = messages.length + 1;
    setMessages((prev) => [
      ...prev,
      { role: "user", content: question },
      { role: "assistant", content: "", sources: undefined },
    ]);
    setInput("");
    setStatus("streaming");
    setErrorMsg(null);

    void runAskNotes({
      question,
      history,
      signal: controller.signal,
      onSources: (notes) => {
        setMessages((prev) => {
          const next = [...prev];
          if (next[assistantIndex]) {
            next[assistantIndex] = { ...next[assistantIndex], sources: notes };
          }
          return next;
        });
      },
      onToken: (chunk) => {
        setMessages((prev) => {
          const next = [...prev];
          if (next[assistantIndex]) {
            next[assistantIndex] = {
              ...next[assistantIndex],
              content: next[assistantIndex].content + chunk,
            };
          }
          return next;
        });
      },
      onError: (msg) => {
        setErrorMsg(msg);
        setStatus("error");
      },
    }).then(() => {
      setStatus((s) => (s === "error" ? s : "done"));
    });
  }, [input, messages]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger
        render={
          <Button variant="ghost" size="icon" aria-label="Ask my notes">
            <MessageSquareIcon />
          </Button>
        }
      />
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b">
          <SheetTitle>Ask my notes</SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-auto p-4 space-y-4">
          {messages.length === 0 && (
            <div className="text-xs text-muted-foreground">
              Ask a question about your notes.
            </div>
          )}
          {messages.map((m, i) => {
            const assistantIdx = Math.floor((i - 1) / 2);
            if (m.role === "user") {
              return (
                <div
                  key={i}
                  className="ml-auto max-w-[85%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground"
                >
                  {m.content}
                </div>
              );
            }
            return (
              <div key={i} className="max-w-[85%]">
                <div
                  data-testid={`assistant-msg-${assistantIdx}`}
                  className="whitespace-pre-wrap rounded-lg bg-muted px-3 py-2 text-sm text-foreground"
                >
                  {m.content}
                </div>
                {m.sources && m.sources.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {m.sources.map((s) => (
                      <Link
                        key={s.id}
                        href={`/n/${s.slug}`}
                        className="inline-flex items-center rounded-md border border-border bg-background px-2 py-0.5 text-xs text-foreground hover:bg-accent transition-colors"
                        onClick={() => setIsOpen(false)}
                      >
                        {s.title}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {errorMsg && (
            <div
              data-testid="ask-notes-error"
              className="text-xs text-destructive"
            >
              {errorMsg}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 border-t p-3">
          <Input
            placeholder="Ask a question..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <Button
            variant="default"
            size="sm"
            onClick={handleSend}
            disabled={input.trim().length === 0}
          >
            Send
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

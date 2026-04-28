"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Sparkles, X } from "lucide-react";
import { AgentTranscript } from "./AgentTranscript";
import { useDoubleTapSpace } from "@/hooks/useDoubleTapSpace";
import { derivePageContext } from "@/lib/page-context";

const LS_KEY = "episteme.agent.lastThread";

interface AgentBallProps {
  /** Reserved for future per-user telemetry / overrides. */
  userId?: string;
}

async function ensureThreadId(signal: AbortSignal): Promise<string | null> {
  try {
    const cached =
      typeof window !== "undefined" ? window.localStorage.getItem(LS_KEY) : null;
    if (cached) return cached;
    const list = await fetch("/api/agent/threads", { credentials: "include", signal });
    if (list.ok) {
      const data = (await list.json()) as { threads?: Array<{ threadId: string }> };
      const recent = data.threads?.[0]?.threadId;
      if (recent) {
        window.localStorage.setItem(LS_KEY, recent);
        return recent;
      }
    }
    const created = await fetch("/api/agent/threads", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
      signal,
    });
    if (created.ok) {
      const data = (await created.json()) as { thread?: { threadId: string } };
      const id = data.thread?.threadId;
      if (id) {
        window.localStorage.setItem(LS_KEY, id);
        return id;
      }
    }
  } catch {
    // aborted or network error — caller falls back to "Loading…"
  }
  return null;
}

export function AgentBall(_props: AgentBallProps) {
  const [open, setOpen] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const pathname = usePathname() ?? "/";
  const pageContext = derivePageContext(pathname);

  const toggle = useCallback(() => setOpen((v) => !v), []);
  useDoubleTapSpace(toggle);

  useEffect(() => {
    if (!open || threadId) return;
    const ctl = new AbortController();
    void ensureThreadId(ctl.signal).then((id) => {
      if (!ctl.signal.aborted && id) setThreadId(id);
    });
    return () => ctl.abort();
  }, [open, threadId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open agent"
        className="fixed bottom-4 right-4 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg hover:opacity-90"
        data-testid="agent-ball"
      >
        <Sparkles className="h-5 w-5" />
      </button>
    );
  }

  return (
    <div
      role="dialog"
      aria-label="Agent"
      data-testid="agent-panel"
      className="fixed bottom-4 right-4 z-50 flex h-[600px] w-[400px] max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] flex-col rounded-lg border bg-background shadow-xl"
    >
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Sparkles className="h-4 w-4" />
          Agent
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close agent"
          className="rounded p-1 hover:bg-muted"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 min-h-0">
        {threadId ? (
          <AgentTranscript threadId={threadId} pageContext={pageContext} fullHeight />
        ) : (
          <div className="p-3 text-xs text-muted-foreground">Loading…</div>
        )}
      </div>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Sparkles, X, PlusIcon } from "lucide-react";
import { AgentTranscript } from "./AgentTranscript";
import { useDoubleTapSpace } from "@/hooks/useDoubleTapSpace";
import { derivePageContext } from "@/lib/page-context";
import { useAgentBall } from "./agent-ball-context";

interface AgentBallProps {
  /** Reserved for future per-user telemetry / overrides. */
  userId?: string;
}

async function ensureThreadId(signal: AbortSignal): Promise<string | null> {
  try {
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
      if (id) return id;
    }
  } catch {
    // aborted or network error — caller falls back to "Loading…"
  }
  return null;
}

export function AgentBall(_props: AgentBallProps) {
  const agentBall = useAgentBall();
  const [threadId, setThreadId] = useState<string | null>(null);
  const [prefilledPrompt, setPrefilledPrompt] = useState<string | null>(null);
  const [prefilledSkill, setPrefilledSkill] = useState<string | null>(null);
  const open = agentBall.open;
  const pathname = usePathname() ?? "/";
  const pageContext = derivePageContext(pathname);

  // When opened externally (via context), consume the initial prompt + skill
  useEffect(() => {
    if (open) {
      const { prompt, skill } = agentBall.consumeInitialPrompt();
      if (prompt) setPrefilledPrompt(prompt);
      if (skill) setPrefilledSkill(skill);
    }
  }, [open, agentBall]);

  const toggle = useCallback(() => {
    if (open) agentBall.close();
    else agentBall.openWithPrompt("");
  }, [open, agentBall]);
  useDoubleTapSpace(toggle);

  const startNewChat = useCallback(async () => {
    try {
      const res = await fetch("/api/agent/threads", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { thread?: { threadId: string } };
      const id = data.thread?.threadId;
      if (id) {
        setThreadId(id);
      }
    } catch {
      // network error — keep current thread
    }
  }, []);

  const closePanel = useCallback(() => {
    agentBall.close();
    setThreadId(null);
    setPrefilledPrompt(null);
    setPrefilledSkill(null);
  }, [agentBall]);

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
      if (e.key === "Escape") closePanel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, closePanel]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => agentBall.openWithPrompt("")}
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
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={startNewChat}
            aria-label="New chat"
            title="New chat"
            className="rounded p-1 hover:bg-muted"
            data-testid="agent-new-chat"
          >
            <PlusIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={closePanel}
            aria-label="Close agent"
            className="rounded p-1 hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0">
        {threadId ? (
          <AgentTranscript
            key={threadId}
            threadId={threadId}
            pageContext={pageContext}
            fullHeight
            initialPrompt={prefilledPrompt}
            initialSkill={prefilledSkill}
          />
        ) : (
          <div className="p-3 text-xs text-muted-foreground">Loading…</div>
        )}
      </div>
    </div>
  );
}

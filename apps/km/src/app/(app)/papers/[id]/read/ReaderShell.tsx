"use client";

import { useCallback, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { AgentTranscript } from "@/components/agent/AgentTranscript";
import { useAgentBallStore } from "@/state/agent-ball";

const Reader = dynamic(
  () => import("@episteme/reader").then((m) => m.Reader),
  { ssr: false, loading: () => <div data-reader-loading>Loading…</div> },
);

async function createThread(signal: AbortSignal): Promise<string | null> {
  try {
    const res = await fetch("/api/agent/threads", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
      signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { thread?: { threadId: string } };
    return data.thread?.threadId ?? null;
  } catch {
    return null;
  }
}

export function ReaderShell({ paperId }: { paperId: string }) {
  const panelOpen = useAgentBallStore((s) => s.panelOpen);
  const mountPoint = useAgentBallStore((s) => s.mountPoint);
  const activeThreadId = useAgentBallStore((s) => s.activeThreadId);
  const openInReader = useAgentBallStore((s) => s.openInReader);
  const close = useAgentBallStore((s) => s.close);

  const agentOpen = panelOpen && mountPoint === "reader-side-panel";

  const threadCtlRef = useRef<AbortController | null>(null);
  const threadInFlightRef = useRef<Promise<string | null> | null>(null);

  const ensureThread = useCallback((): Promise<string | null> => {
    const existing = useAgentBallStore.getState().activeThreadId;
    if (existing) return Promise.resolve(existing);
    if (threadInFlightRef.current) return threadInFlightRef.current;
    threadCtlRef.current?.abort();
    const ctl = new AbortController();
    threadCtlRef.current = ctl;
    const p = createThread(ctl.signal).then((id) => {
      threadInFlightRef.current = null;
      if (ctl.signal.aborted) return null;
      if (id) useAgentBallStore.getState().setActiveThread(id);
      return id;
    });
    threadInFlightRef.current = p;
    return p;
  }, []);

  useEffect(() => {
    if (!agentOpen || activeThreadId) return;
    void ensureThread();
  }, [agentOpen, activeThreadId, ensureThread]);

  useEffect(() => {
    return () => {
      threadCtlRef.current?.abort();
      useAgentBallStore.getState().close();
    };
  }, []);

  const handleAgentOpenChange = useCallback(
    (open: boolean) => {
      if (open) openInReader();
      else close();
    },
    [openInReader, close],
  );

  const handleExplainPassage = useCallback(
    async ({ page, text }: { page: number; text: string }) => {
      openInReader();
      const tid = await ensureThread();
      if (!tid) return;
      await fetch("/api/agents/km/invoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          thread_id: tid,
          message: `Explain this passage from page ${page} of paper ${paperId}: "${text}"`,
        }),
      });
    },
    [openInReader, ensureThread, paperId],
  );

  const agentSlot = activeThreadId ? (
    <AgentTranscript key={activeThreadId} threadId={activeThreadId} fullHeight />
  ) : (
    <div className="p-3 text-xs text-muted-foreground">Loading…</div>
  );

  return (
    <div className="h-full min-h-0">
      <Reader
        paperId={paperId}
        mode="full"
        onExplainPassage={handleExplainPassage}
        agentSlot={agentSlot}
        agentOpen={agentOpen}
        onAgentOpenChange={handleAgentOpenChange}
      />
    </div>
  );
}

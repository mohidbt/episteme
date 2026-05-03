"use client";

import { useCallback, useEffect } from "react";
import dynamic from "next/dynamic";
import { ReaderSidePanel } from "@episteme/reader";
import { AgentTranscript } from "@/components/agent/AgentTranscript";
import { useAgentBallStore } from "@/state/agent-ball";
import { Matrix, pulse } from "@/components/ui/matrix";

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
  const setActiveThread = useAgentBallStore((s) => s.setActiveThread);
  const openInReader = useAgentBallStore((s) => s.openInReader);
  const close = useAgentBallStore((s) => s.close);

  const sidePanelOpen = panelOpen && mountPoint === "reader-side-panel";

  // Mirror AgentBall's pattern — when the side panel opens without a thread,
  // create one. Cancel on unmount/close.
  useEffect(() => {
    if (!sidePanelOpen || activeThreadId) return;
    const ctl = new AbortController();
    void createThread(ctl.signal).then((id) => {
      if (!ctl.signal.aborted && id) setActiveThread(id);
    });
    return () => ctl.abort();
  }, [sidePanelOpen, activeThreadId, setActiveThread]);

  const handleClose = useCallback(() => {
    close();
  }, [close]);

  // Reset store mount point on unmount (route change away from reader) so
  // the global AgentBall on other routes does not stay hidden.
  useEffect(() => {
    return () => {
      useAgentBallStore.getState().close();
    };
  }, []);

  const handleOpen = useCallback(() => {
    openInReader();
  }, [openInReader]);

  const handleExplainPassage = useCallback(
    async ({ page, text }: { page: number; text: string }) => {
      // Open the side panel synchronously so the UI reacts immediately.
      openInReader();
      // Ensure a thread exists before invoking — the side-panel useEffect
      // creates one lazily, but on a first explain-click it may not exist.
      let tid = useAgentBallStore.getState().activeThreadId;
      if (!tid) {
        tid = await createThread(new AbortController().signal);
        if (tid) setActiveThread(tid);
      }
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
    [openInReader, setActiveThread, paperId]
  );

  return (
    <div className="flex h-full min-h-0">
      <div className="relative flex-1 min-w-0">
        <Reader paperId={paperId} mode="full" onExplainPassage={handleExplainPassage} />
        {!sidePanelOpen ? (
          <button
            type="button"
            data-testid="reader-agent-ball"
            aria-label="Open agent"
            onClick={handleOpen}
            className="fixed bottom-6 right-6 z-40 inline-flex items-center justify-center rounded-md bg-background/80 p-2 text-foreground shadow-lg backdrop-blur hover:scale-105 transition-transform duration-150 ease-out"
          >
            <Matrix
              rows={7}
              cols={7}
              size={4}
              gap={2}
              autoplay
              frames={pulse}
              fps={4}
              loop
              ariaLabel="Open agent"
            />
          </button>
        ) : null}
      </div>
      <ReaderSidePanel isOpen={sidePanelOpen} onClose={handleClose} title="Agent">
        {activeThreadId ? (
          <AgentTranscript
            key={activeThreadId}
            threadId={activeThreadId}
            fullHeight
          />
        ) : (
          <div className="p-3 text-xs text-muted-foreground">Loading…</div>
        )}
      </ReaderSidePanel>
    </div>
  );
}

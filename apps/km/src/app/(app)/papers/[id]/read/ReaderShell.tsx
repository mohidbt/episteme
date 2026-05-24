"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { AgentTranscript } from "@/components/agent/AgentTranscript";
import { PastThreadsDropdown } from "@/components/agent/PastThreadsDropdown";
import { useAgentBallStore } from "@/state/agent-ball";

const Reader = dynamic(
  () => import("@episteme/reader").then((m) => m.Reader),
  { ssr: false, loading: () => <div data-reader-loading /> },
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

function ReaderShellInner({ paperId }: { paperId: string }) {
  const searchParams = useSearchParams();
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

  // BG2a — citation pills navigate with `?p=<n>`. Parse once and pass as
  // `initialPage` to Reader; Reader owns the scroll-jump inside its own
  // mount lifecycle so listener registration is guaranteed before consumption
  // (replaces previous `queueMicrotask` + window-dispatch race).
  const initialPage = useMemo(() => {
    const raw = searchParams?.get("p");
    if (!raw) return undefined;
    const page = Number(raw);
    if (!Number.isFinite(page) || page < 1) return undefined;
    return page;
  }, [searchParams]);

  // A4 — Reader dispatches `episteme:reader-toast` when scroll-to-segment
  // exhausts its rAF retry budget. Surface it via Sonner so the user sees
  // why the citation jump did nothing.
  useEffect(() => {
    const onToast = (ev: Event) => {
      const detail = (ev as CustomEvent<{ kind?: "error" | "info"; message?: string }>).detail;
      const message = detail?.message;
      if (!message) return;
      if (detail?.kind === "error") toast.error(message);
      else toast(message);
    };
    window.addEventListener("episteme:reader-toast", onToast as EventListener);
    return () => window.removeEventListener("episteme:reader-toast", onToast as EventListener);
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
          // K8 follow-up: stamp the thread with the current paper so it
          // shows up in the PastThreadsDropdown on subsequent visits.
          page_context: { paperId },
        }),
      });
    },
    [openInReader, ensureThread, paperId],
  );

  // K8 — past-threads-on-this-paper dropdown sits above the transcript. When
  // the user picks a past thread we swap `activeThreadId` directly via the
  // store, and the `key={activeThreadId}` on <AgentTranscript> below remounts
  // it so the existing /state hydration path replays the chosen history.
  const handlePickPastThread = useCallback((threadId: string) => {
    useAgentBallStore.getState().setActiveThread(threadId);
  }, []);

  const agentSlot = activeThreadId ? (
    <div className="flex h-full min-h-0 flex-col">
      <PastThreadsDropdown
        paperId={paperId}
        onSelect={handlePickPastThread}
        activeThreadId={activeThreadId}
      />
      <div className="min-h-0 flex-1">
        <AgentTranscript
          key={activeThreadId}
          threadId={activeThreadId}
          fullHeight
          pageContext={{ paperId }}
        />
      </div>
    </div>
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
        initialPage={initialPage}
      />
    </div>
  );
}

// `useSearchParams` requires a Suspense boundary in the App Router; the
// parent page.tsx is a Server Component with no boundary, so wrap here.
export function ReaderShell({ paperId }: { paperId: string }) {
  return (
    <Suspense fallback={null}>
      <ReaderShellInner paperId={paperId} />
    </Suspense>
  );
}

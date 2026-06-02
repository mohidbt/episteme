"use client";

import type { ComponentProps } from "react";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { postHighlightsChange } from "@episteme/reader/highlights-channel";
import { AgentTranscript } from "@/components/agent/AgentTranscript";
import { PastThreadsDropdown } from "@/components/agent/PastThreadsDropdown";
import { useAgentBallStore } from "@/state/agent-ball";

// N8 — historical messages prop shape (mirror of AgentTranscript.initialMessages).
// Kept loose: the route is uncached on the python side and the SSE merger is
// resilient to extra fields, so we just pass through whatever /state returned.
type HydratedMessage = NonNullable<
  ComponentProps<typeof AgentTranscript>["initialMessages"]
>[number];

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

  // K8 follow-up (codex NEEDS-FIX): the thread→paper row is stamped on the
  // python side during `/invoke`, NOT when `setActiveThread` fires. Bump
  // this counter only after `/invoke` resolves so the PastThreadsDropdown
  // refetch sees the newly-stamped row.
  const [pastThreadsRefreshKey, setPastThreadsRefreshKey] = useState(0);

  // N8 — when the user picks a past thread from <PastThreadsDropdown>, the
  // reader-side <AgentTranscript> mounts with `key={activeThreadId}` but
  // without `initialMessages`, so its hydration path renders an empty
  // transcript. Mirror the /agents/[id] server-component behaviour by
  // fetching persisted messages here and passing them down. Held in local
  // state keyed by the thread id we fetched for, so a stale response for a
  // since-superseded thread doesn't overwrite a newer hydration.
  const [hydratedMessages, setHydratedMessages] = useState<{
    threadId: string;
    messages: HydratedMessage[];
  } | null>(null);

  useEffect(() => {
    if (!activeThreadId) {
      setHydratedMessages(null);
      return;
    }
    // Reset so we don't pass a previous thread's history into the newly-keyed
    // AgentTranscript while the fetch is in flight.
    setHydratedMessages(null);
    const ctl = new AbortController();
    const tid = activeThreadId;
    void (async () => {
      try {
        const res = await fetch(
          `/api/agents/km/state/${encodeURIComponent(tid)}`,
          { credentials: "include", signal: ctl.signal },
        );
        if (ctl.signal.aborted) return;
        if (!res.ok) {
          // Codex follow-up: on fetch failure, still mount the transcript with
          // an empty history so the UI proceeds (otherwise the skeleton hangs
          // forever). The threadId match below gates the mount.
          // Surface status so a silently-failing 401/403/500 doesn't look
          // identical to a genuinely empty thread.
          console.error("[reader] /state fetch failed", { threadId: tid, status: res.status });
          setHydratedMessages({ threadId: tid, messages: [] });
          return;
        }
        const data = (await res.json()) as { messages?: HydratedMessage[] };
        if (ctl.signal.aborted) return;
        setHydratedMessages({
          threadId: tid,
          messages: Array.isArray(data.messages) ? data.messages : [],
        });
      } catch {
        if (ctl.signal.aborted) return;
        setHydratedMessages({ threadId: tid, messages: [] });
      }
    })();
    return () => ctl.abort();
  }, [activeThreadId]);

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
      // Race guard: if user picked a past thread from the dropdown while
      // this create was in flight, do NOT overwrite their selection with
      // the freshly-created empty thread id.
      if (useAgentBallStore.getState().activeThreadId) return null;
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
      const res = await fetch("/api/agents/km/invoke", {
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
      // Stamping happens inside `/invoke`. Only bump the dropdown's refresh
      // key after it returns OK — otherwise we'd race the python write.
      if (res.ok) {
        setPastThreadsRefreshKey((k) => k + 1);
      }
    },
    [openInReader, ensureThread, paperId],
  );

  // K8 — past-threads-on-this-paper dropdown sits above the transcript. When
  // the user picks a past thread we swap `activeThreadId` directly via the
  // store, and the `key={activeThreadId}` on <AgentTranscript> below remounts
  // it so the existing /state hydration path replays the chosen history.
  const handlePickPastThread = useCallback((threadId: string) => {
    // Abort any in-flight `ensureThread()` POST so its .then() can't
    // overwrite the user's pick with a freshly-created empty thread id.
    threadCtlRef.current?.abort();
    threadInFlightRef.current = null;
    useAgentBallStore.getState().setActiveThread(threadId);
  }, []);

  // K8 follow-up: chat-input messages go through AgentTranscript.defaultSend
  // → POST /api/agents/km/invoke (NOT through `handleExplainPassage`). The
  // server stamps thread→paper during that /invoke, so the dropdown's
  // refetch must be triggered after AgentTranscript's SSE stream completes —
  // not just after the explain-passage POST resolves.
  const handleAgentStreamDone = useCallback(() => {
    setPastThreadsRefreshKey((k) => k + 1);
    // Chat-agent tools may have written paper_highlights rows (AI highlight
    // tool). Fan-out a channel event so the reader's usePaperHighlights hook
    // refetches immediately instead of waiting for the 5-min backstop / focus.
    postHighlightsChange({ paperId, source: "ai" });
  }, [paperId]);

  const agentSlot = activeThreadId ? (
    <div className="flex h-full min-h-0 flex-col">
      <PastThreadsDropdown
        paperId={paperId}
        onSelect={handlePickPastThread}
        activeThreadId={activeThreadId}
        refreshKey={pastThreadsRefreshKey}
      />
      <div className="min-h-0 flex-1">
        {hydratedMessages?.threadId === activeThreadId ? (
          <AgentTranscript
            key={activeThreadId}
            threadId={activeThreadId}
            fullHeight
            pageContext={{ paperId }}
            onStreamDone={handleAgentStreamDone}
            initialMessages={hydratedMessages.messages}
          />
        ) : (
          <div className="p-3 text-xs text-muted-foreground">Loading thread…</div>
        )}
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

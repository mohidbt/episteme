"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { X, PlusIcon, ChevronDown, ChevronUp, Maximize2, Minimize2 } from "lucide-react";
import { AgentTranscript } from "./AgentTranscript";
import { useDoubleTapSpace } from "@/hooks/useDoubleTapSpace";
import { useDragX } from "@/hooks/useDragX";
import { derivePageContext } from "@/lib/page-context";
import { useAgentBall } from "./agent-ball-context";
import { Matrix, loader, pulse, wave } from "@/components/ui/matrix";

interface AgentBallProps {
  /** Reserved for future per-user telemetry / overrides. */
  userId?: string;
}

type BallPreset = "inactive" | "active" | "working";

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

interface MatrixBadgeProps {
  preset: BallPreset;
  size?: number;
  gap?: number;
}

function MatrixBadge({ preset, size = 4, gap = 2 }: MatrixBadgeProps) {
  const props = useMemo(() => {
    switch (preset) {
      case "working":
        return { frames: loader, fps: 18, loop: true, ariaLabel: "Agent working" } as const;
      case "active":
        return { frames: wave, fps: 12, loop: true, ariaLabel: "Agent active" } as const;
      case "inactive":
      default:
        return { frames: pulse, fps: 4, loop: true, ariaLabel: "Open agent" } as const;
    }
  }, [preset]);

  return (
    <Matrix
      rows={7}
      cols={7}
      size={size}
      gap={gap}
      autoplay
      data-testid={`agent-matrix-${preset}`}
      {...props}
    />
  );
}

export function AgentBall(_props: AgentBallProps) {
  const agentBall = useAgentBall();
  const [threadId, setThreadId] = useState<string | null>(null);
  const [prefilledPrompt, setPrefilledPrompt] = useState<string | null>(null);
  const [prefilledSkill, setPrefilledSkill] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const ballDrag = useDragX({ storageKey: "agent-ball-x", elementWidth: 56 });
  const panelDrag = useDragX({ storageKey: "agent-convo-x", elementWidth: 400 });
  const open = agentBall.open;
  const working = agentBall.working;
  const pathname = usePathname() ?? "/";
  const pageContext = derivePageContext(pathname);

  const preset: BallPreset = working ? "working" : open ? "active" : "inactive";

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
    const positioned = ballDrag.x !== null;
    const positionClass = positioned
      ? "fixed bottom-4 z-50"
      : "fixed bottom-4 left-1/2 -translate-x-1/2 z-50";
    return (
      <button
        type="button"
        onClick={() => agentBall.openWithPrompt("")}
        aria-label="Open agent"
        data-testid="agent-ball"
        data-preset={preset}
        style={positioned ? { left: `${ballDrag.x}px` } : undefined}
        {...ballDrag.pointerHandlers}
        className={`${positionClass} flex h-14 w-14 items-center justify-center rounded-full border border-border/60 bg-background/80 backdrop-blur-md text-foreground shadow-lg hover:opacity-90 transition-opacity touch-none select-none`}
      >
        <MatrixBadge preset={preset} />
      </button>
    );
  }

  const panelPositioned = panelDrag.x !== null;
  const panelLayoutClass = fullscreen
    ? "fixed inset-0 z-50 flex flex-col rounded-lg border bg-background shadow-xl"
    : panelPositioned
      ? "fixed bottom-4 z-50 flex h-[600px] w-[400px] max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] flex-col rounded-lg border bg-background shadow-xl"
      : "fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex h-[600px] w-[400px] max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] flex-col rounded-lg border bg-background shadow-xl";

  return (
    <div
      role="dialog"
      aria-label="Co-Scientist"
      data-testid="agent-panel"
      data-preset={preset}
      data-collapsed={collapsed ? "true" : "false"}
      style={!fullscreen && panelPositioned ? { left: `${panelDrag.x}px` } : undefined}
      className={panelLayoutClass}
    >
      <div
        className="flex items-center justify-between border-b px-3 py-2 cursor-grab active:cursor-grabbing select-none touch-none"
        {...(fullscreen ? {} : panelDrag.pointerHandlers)}
      >
        <div className="flex items-center gap-2 text-sm font-medium">
          <span className="inline-flex items-center justify-center">
            <MatrixBadge preset={preset} size={2} gap={1} />
          </span>
          Co-Scientist
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
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? "Expand agent" : "Collapse agent"}
            title={collapsed ? "Expand" : "Collapse"}
            className="rounded p-1 hover:bg-muted"
            data-testid="agent-collapse"
          >
            {collapsed ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setFullscreen((f) => !f)}
            aria-label={fullscreen ? "Exit fullscreen agent" : "Fullscreen agent"}
            title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
            className="rounded p-1 hover:bg-muted"
            data-testid="agent-fullscreen"
          >
            {fullscreen ? (
              <Minimize2 className="h-4 w-4" />
            ) : (
              <Maximize2 className="h-4 w-4" />
            )}
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
      <div
        className={`flex-1 min-h-0${collapsed ? " hidden" : ""}`}
        data-testid="agent-panel-body"
      >
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

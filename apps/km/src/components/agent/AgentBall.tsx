"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  // Ball is rendered as a 7x7 matrix at size=4 gap=2 → 7*(4+2) - 2 = 40px.
  const BALL_PX = 40;
  const ballDrag = useDragX({
    storageKey: "agent-ball-x",
    elementWidth: BALL_PX,
    elementHeight: BALL_PX,
    axis: "xy",
    snapY: "bottom",
    bottomInsetRatio: 0.12,
  });
  const panelDrag = useDragX({ storageKey: "agent-convo-x", elementWidth: 400 });
  const ballRef = useRef<HTMLButtonElement | null>(null);
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

  // #146 — double-space/click on open panel COLLAPSES (preserves state),
  // not closes/destroys. Clicking the collapsed ball re-expands.
  const toggle = useCallback(() => {
    if (open) setCollapsed((c) => !c);
    else agentBall.openWithPrompt("");
  }, [open, agentBall]);

  // #90 — only toggle on click if the pointer did NOT move beyond the drag
  // threshold (otherwise a drag gesture would accidentally open/close).
  const onClickBall = useCallback(() => {
    if (ballDrag.didMoveRef.current) return;
    toggle();
  }, [ballDrag.didMoveRef, toggle]);

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
    const positionedX = ballDrag.x !== null;
    const positionedY = ballDrag.y !== null;
    // X positioning: explicit left if dragged, else centered. Y positioning:
    // explicit top if dragged (snaps to bottom on release), else default
    // bottom-4 anchor.
    const positionClass = positionedX
      ? positionedY
        ? "fixed z-50"
        : "fixed bottom-4 z-50"
      : positionedY
        ? "fixed left-1/2 -translate-x-1/2 z-50"
        : "fixed bottom-4 left-1/2 -translate-x-1/2 z-50";

    const inlineStyle: React.CSSProperties = {};
    if (positionedX) inlineStyle.left = `${ballDrag.x}px`;
    if (positionedY) inlineStyle.top = `${ballDrag.y}px`;

    // RG1 #59 — Matrix renders standalone (no circular wrapper). Subtle
    // drop-shadow keeps it visible on light/dark surfaces.
    return (
      <button
        ref={ballRef}
        type="button"
        onClick={onClickBall}
        aria-label="Open agent"
        data-testid="agent-ball"
        data-preset={preset}
        style={inlineStyle}
        {...ballDrag.pointerHandlers}
        className={`${positionClass} inline-flex items-center justify-center text-foreground drop-shadow-md hover:scale-105 transition-[opacity,transform] duration-150 ease-out touch-none select-none`}
      >
        <MatrixBadge preset={preset} />
      </button>
    );
  }

  const panelPositioned = panelDrag.x !== null;
  // G-R3-05 #77 — expanded panel must not cover the sidebar or the TabBar.
  // top clamps to bottom of TabBar; max-h prevents overflow above; max-w
  // prevents overflow into the sidebar. Bottom anchor (bottom-4) keeps the
  // panel resting just above the matrix ball.
  const panelBoundsClass = `top-[var(--tabbar-h)] max-h-[calc(100dvh-var(--tabbar-h))] max-w-[calc(100vw-var(--sidebar-width))]`;
  // Default open size: roomy enough to be useful (≥600px tall, 480px wide on
  // typical viewports). On small viewports the max-h/max-w clamps win.
  const panelSizeClass = `h-[min(720px,calc(100dvh-var(--tabbar-h)-2rem))] w-[min(480px,calc(100vw-var(--sidebar-width)-2rem))]`;
  const panelLayoutClass = fullscreen
    ? `fixed inset-0 z-50 flex flex-col rounded-lg border bg-background shadow-xl`
    : panelPositioned
      ? `fixed bottom-4 z-50 flex ${panelSizeClass} ${panelBoundsClass} flex-col rounded-lg border bg-background shadow-xl`
      : `fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex ${panelSizeClass} ${panelBoundsClass} flex-col rounded-lg border bg-background shadow-xl`;

  // G-R3-05 #76 — when collapsed, animate the panel down into the matrix
  // square: scale to a 40px ball anchored at the bottom-center while keeping
  // the transcript mounted (state preserved). Click the shrunk panel to
  // re-expand.
  const shrunkStyle: React.CSSProperties =
    collapsed && !fullscreen
      ? {
          transformOrigin: "bottom center",
          transform: "scale(0.1)",
          opacity: 0,
          pointerEvents: "none",
        }
      : {};
  const inlineStyle: React.CSSProperties = {
    ...(!fullscreen && panelPositioned ? { left: `${panelDrag.x}px` } : {}),
    ...shrunkStyle,
    transition: "transform 220ms ease-out, opacity 220ms ease-out",
  };

  return (
    <>
      {collapsed && !fullscreen ? (
        <button
          type="button"
          data-testid="agent-ball-collapsed"
          aria-label="Reopen agent"
          onClick={() => setCollapsed(false)}
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 inline-flex items-center justify-center text-foreground drop-shadow-md hover:scale-105 transition-[opacity,transform] duration-150 ease-out touch-none select-none"
        >
          <MatrixBadge preset={preset} />
        </button>
      ) : null}
    <div
      role="dialog"
      aria-label="Agent"
      data-testid="agent-panel"
      data-preset={preset}
      data-collapsed={collapsed ? "true" : "false"}
      data-shrunk={collapsed && !fullscreen ? "true" : "false"}
      style={inlineStyle}
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
    </>
  );
}

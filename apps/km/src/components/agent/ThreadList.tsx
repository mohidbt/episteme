"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { NewConversationButton } from "./NewConversationButton";
import type { AgentThreadRow, AgentThreadStatus } from "@/lib/threads";

export interface ThreadListProps {
  initialThreads: AgentThreadRow[];
}

interface ThreadJson extends Omit<AgentThreadRow, "createdAt" | "updatedAt" | "lastMessageAt"> {
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
}

const POLL_INTERVAL_MS = 5000;

function statusBadge(status: AgentThreadStatus) {
  switch (status) {
    case "running":
      return (
        <Badge variant="default" data-testid="status-chip" data-status={status}>
          <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
          running
        </Badge>
      );
    case "awaiting_hitl":
      return (
        <Badge
          variant="secondary"
          className="bg-amber-100 text-amber-900 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-300"
          data-testid="status-chip"
          data-status={status}
        >
          needs approval
        </Badge>
      );
    case "error":
      return (
        <Badge variant="destructive" data-testid="status-chip" data-status={status}>
          error
        </Badge>
      );
    case "idle":
    default:
      return (
        <Badge variant="secondary" data-testid="status-chip" data-status={status}>
          idle
        </Badge>
      );
  }
}

function reviveThread(t: ThreadJson | AgentThreadRow): AgentThreadRow {
  return {
    ...t,
    createdAt: t.createdAt instanceof Date ? t.createdAt : new Date(t.createdAt),
    updatedAt: t.updatedAt instanceof Date ? t.updatedAt : new Date(t.updatedAt),
    lastMessageAt:
      t.lastMessageAt == null
        ? null
        : t.lastMessageAt instanceof Date
          ? t.lastMessageAt
          : new Date(t.lastMessageAt),
  };
}

function threadTitle(t: AgentThreadRow): string {
  if (t.title && t.title.trim()) return t.title;
  return `Conversation #${t.threadId.slice(0, 8)}`;
}

function lastActivity(t: AgentThreadRow): string {
  const d = t.lastMessageAt ?? t.createdAt;
  try {
    return formatDistanceToNow(d, { addSuffix: true });
  } catch {
    return "";
  }
}

export function ThreadList({ initialThreads }: ThreadListProps) {
  const router = useRouter();
  const [threads, setThreads] = useState<AgentThreadRow[]>(initialThreads);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/agent/threads", { cache: "no-store" });
      if (res.status === 401) {
        // Session expired: stop polling and bounce to sign-in.
        if (intervalRef.current != null) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        toast.error("Session expired");
        router.push("/sign-in");
        return;
      }
      if (!res.ok) return;
      const data = (await res.json()) as { threads: ThreadJson[] };
      setThreads(data.threads.map(reviveThread));
    } catch {
      // Silent — next tick will retry.
    }
  }, [router]);

  useEffect(() => {
    const start = () => {
      if (intervalRef.current != null) return;
      intervalRef.current = setInterval(() => {
        void refresh();
      }, POLL_INTERVAL_MS);
    };
    const stop = () => {
      if (intervalRef.current != null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };

    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      // Don't start polling while hidden.
    } else {
      start();
    }

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        stop();
      } else {
        void refresh();
        start();
      }
    };
    const onFocus = () => {
      void refresh();
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  if (threads.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
        <div>
          <p className="font-display text-xl">No conversations yet</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Start a conversation with the agent to get going.
          </p>
        </div>
        <NewConversationButton />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl leading-none tracking-tight">Convos</h1>
        <NewConversationButton />
      </div>
      <ul className="divide-y rounded-md border" data-testid="thread-list">
        {threads.map((t) => (
          <li key={t.threadId}>
            <button
              type="button"
              onClick={() => router.push(`/agents/${t.threadId}`)}
              className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left hover:bg-muted/50"
              data-testid="thread-row"
              data-thread-id={t.threadId}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">
                    {threadTitle(t)}
                  </span>
                  {t.skill ? (
                    <Badge variant="outline" className="text-[10px]">
                      {t.skill}
                    </Badge>
                  ) : null}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {lastActivity(t)}
                </div>
              </div>
              <div className="shrink-0">{statusBadge(t.status)}</div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

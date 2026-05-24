"use client";

import { useEffect, useState } from "react";

interface PastThread {
  thread_id: string;
  created_at: string;
}

interface Props {
  paperId: string;
  /** Called when the user picks a past thread. Parent re-hydrates via /state. */
  onSelect: (threadId: string) => void;
  /** Highlight the active thread; rows for this id show as "(current)". */
  activeThreadId?: string | null;
}

/**
 * K8 — Past agent threads for the current paper. Renders a compact native
 * `<select>` above the reader's agent panel; selecting a thread asks the
 * parent (ReaderShell) to swap `activeThreadId`, which triggers the
 * existing /state hydration path in AgentTranscript.
 *
 * Hidden when there are zero past threads — there's nothing useful to show.
 */
export function PastThreadsDropdown({ paperId, onSelect, activeThreadId }: Props) {
  const [threads, setThreads] = useState<PastThread[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch(
          `/api/agents/km/threads-for-paper/${paperId}`,
          { credentials: "include" },
        );
        if (!r.ok) {
          if (!cancelled) setThreads([]);
          return;
        }
        const body = (await r.json()) as { threads?: PastThread[] };
        if (!cancelled) setThreads(body.threads ?? []);
      } catch {
        if (!cancelled) setThreads([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [paperId]);

  if (!threads || threads.length === 0) return null;

  return (
    <div
      data-testid="past-threads-dropdown"
      className="border-b px-3 py-2 text-xs text-muted-foreground"
    >
      <label className="flex items-center gap-2">
        <span>Past threads ({threads.length})</span>
        <select
          className="flex-1 rounded border bg-background px-1 py-0.5 text-xs"
          value={activeThreadId ?? ""}
          onChange={(e) => {
            const id = e.target.value;
            if (id) onSelect(id);
          }}
        >
          <option value="" disabled>
            Select a thread…
          </option>
          {threads.map((t) => {
            const isCurrent = t.thread_id === activeThreadId;
            const when = new Date(t.created_at).toLocaleString();
            return (
              <option key={t.thread_id} value={t.thread_id}>
                {when}
                {isCurrent ? " (current)" : ""}
              </option>
            );
          })}
        </select>
      </label>
    </div>
  );
}

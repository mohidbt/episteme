"use client";

import { useEffect, useState } from "react";

interface PastThread {
  thread_id: string;
  created_at: string;
  /** N8 — derived thread title; falls back to timestamp if null/blank. */
  title?: string | null;
}

/**
 * N8 — UI defense. Thread titles come from model output via
 * `deriveThreadTitle(firstUserText)`, which means they can be arbitrarily long
 * or contain hostile control characters / line breaks. Collapse control chars
 * and newlines to a single space, then hard-truncate to 80 chars + ellipsis.
 */
const MAX_TITLE_CHARS = 80;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x1F\x7F]+/g;
function sanitizeTitle(raw: string): string {
  const cleaned = raw.replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim();
  if (cleaned.length <= MAX_TITLE_CHARS) return cleaned;
  return cleaned.slice(0, MAX_TITLE_CHARS) + "…";
}

interface Props {
  paperId: string;
  /** Called when the user picks a past thread. Parent re-hydrates via /state. */
  onSelect: (threadId: string) => void;
  /** Highlight the active thread; rows for this id show as "(current)". */
  activeThreadId?: string | null;
  /**
   * Bump this to force a refetch — the parent (ReaderShell) increments it
   * after `/invoke` resolves so we don't race the thread→paper stamping
   * write on the python side. Changing `activeThreadId` is NOT enough:
   * `setActiveThread` fires before `/invoke` completes.
   */
  refreshKey?: number;
}

/**
 * K8 — Past agent threads for the current paper. Renders a compact native
 * `<select>` above the reader's agent panel; selecting a thread asks the
 * parent (ReaderShell) to swap `activeThreadId`, which triggers the
 * existing /state hydration path in AgentTranscript.
 *
 * Always renders — even with zero threads we show a disabled empty-state so
 * users can see the feature exists. Refetches whenever the parent bumps
 * `refreshKey` (post-`/invoke`) so a newly-stamped thread appears without
 * a full page reload.
 */
export function PastThreadsDropdown({
  paperId,
  onSelect,
  activeThreadId,
  refreshKey = 0,
}: Props) {
  const [threads, setThreads] = useState<PastThread[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Reset to the loading sentinel so we never flash a stale empty-state
    // between the refetch trigger and the new response.
    setThreads(null);
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
    // Deps on `refreshKey` (not `activeThreadId`): the parent bumps the key
    // AFTER `/invoke` resolves, which is the only point at which the
    // thread→paper row is guaranteed to be stamped.
  }, [paperId, refreshKey]);

  // Still mid-fetch — render nothing for one tick to avoid flashing the
  // empty state before the response arrives.
  if (threads === null) return null;

  const isEmpty = threads.length === 0;
  // When `activeThreadId` is a freshly-created thread not yet stamped to
  // this paper (the default state when the reader panel auto-opens), it
  // won't be in `threads`. A controlled <select> with a value that matches
  // no <option> falls back to displaying the first option — which makes
  // the dropdown look like that first thread is "current". Picking it then
  // fires no `change` event (value already matches), so setActiveThread
  // never runs. Coerce to "" in that case so the placeholder shows and any
  // pick fires a real change.
  const selectValue =
    activeThreadId && threads.some((t) => t.thread_id === activeThreadId)
      ? activeThreadId
      : "";

  return (
    <div
      data-testid="past-threads-dropdown"
      className="border-b px-3 py-2 text-xs text-muted-foreground"
    >
      <label className="flex items-center gap-2">
        <span>
          {isEmpty ? "Past threads" : `Past threads (${threads.length})`}
        </span>
        <select
          className="flex-1 rounded border bg-background px-1 py-0.5 text-xs disabled:opacity-60"
          value={selectValue}
          disabled={isEmpty}
          onChange={(e) => {
            const id = e.target.value;
            if (id) onSelect(id);
          }}
        >
          {isEmpty ? (
            <option value="" disabled>
              No past chats on this paper
            </option>
          ) : (
            <option value="" disabled>
              Select a thread…
            </option>
          )}
          {threads.map((t) => {
            const isCurrent = t.thread_id === activeThreadId;
            const trimmedTitle = t.title?.trim();
            const label = trimmedTitle
              ? sanitizeTitle(trimmedTitle)
              : new Date(t.created_at).toLocaleString();
            return (
              <option key={t.thread_id} value={t.thread_id}>
                {label}
                {isCurrent ? " (current)" : ""}
              </option>
            );
          })}
        </select>
      </label>
    </div>
  );
}

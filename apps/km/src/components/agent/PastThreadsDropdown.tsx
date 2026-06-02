"use client";

import { ChevronDown } from "lucide-react";
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
  /** Highlight the active thread; the row for this id appears as "(current)". */
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
 * K8 — Past agent threads for the current paper. Restyled per the Episteme
 * design system: Instrument Serif section label, Geist Mono micro-count,
 * hairline trigger at the 32 px tier, sentence-case copy, Lucide chevron.
 *
 * Still a native `<select>` underneath — the option list is rendered by the
 * OS for keyboard + screen-reader parity, but the trigger chrome is
 * absolute-overlaid so the user sees the design-system surface, not the
 * platform default.
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
  // no <option> falls back to displaying the first option — making it look
  // like that first thread is current. Picking it then fires no `change`
  // event (value already matches), so setActiveThread never runs. Coerce
  // to "" so the placeholder shows and any pick fires a real change.
  const selectValue =
    activeThreadId && threads.some((t) => t.thread_id === activeThreadId)
      ? activeThreadId
      : "";

  const activeTitle = (() => {
    if (!selectValue) return null;
    const t = threads.find((x) => x.thread_id === selectValue);
    if (!t) return null;
    const trimmed = t.title?.trim();
    return trimmed
      ? sanitizeTitle(trimmed)
      : new Date(t.created_at).toLocaleString();
  })();

  const placeholder = isEmpty
    ? "No past chats on this paper"
    : "Select a thread…";

  return (
    <div
      data-testid="past-threads-dropdown"
      className="border-b border-border/60 bg-background px-3 pt-3 pb-2.5"
    >
      <div className="mb-1.5">
        <span className="font-display text-[15px] leading-none tracking-[-0.01em] text-foreground">
          Past threads
        </span>
      </div>
      <div className="group relative h-8">
        <select
          className="peer absolute inset-0 h-full w-full cursor-pointer rounded-[10px] border border-border bg-background pr-8 pl-3 text-sm text-transparent outline-none transition-colors hover:border-foreground/30 focus-visible:border-foreground/40 focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50 [&>option]:text-foreground"
          value={selectValue}
          disabled={isEmpty}
          aria-label={isEmpty ? placeholder : "Past threads on this paper"}
          onChange={(e) => {
            const id = e.target.value;
            if (id) onSelect(id);
          }}
        >
          <option value="" disabled>
            {placeholder}
          </option>
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
        {/* Visual surface — matches the native <select> at pixel level so the
            chevron + label appear over it without intercepting clicks. */}
        <div className="pointer-events-none absolute inset-0 flex h-full items-center gap-1.5 rounded-[10px] border border-transparent pr-8 pl-3">
          <span
            className={
              activeTitle
                ? "truncate text-sm text-foreground"
                : "truncate text-sm text-muted-foreground"
            }
          >
            {activeTitle ?? placeholder}
          </span>
        </div>
        <ChevronDown
          aria-hidden
          className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-muted-foreground transition-colors group-hover:text-foreground"
        />
      </div>
    </div>
  );
}

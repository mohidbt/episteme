/**
 * B8 — derive reader-sidebar "runs" from chat-agent paper_highlights.
 *
 * The chat-agent path inserts rows into `paper_highlights` tagged with a
 * `runId`. The reader sidebar groups them under one run entry per id. We
 * derive a human-meaningful label from the first highlight's note instead
 * of hardcoding "AI highlight" so the sidebar reflects what the agent
 * actually highlighted.
 *
 * Returns runs that aren't already represented in `autoRunIds` (which are
 * the proper `ai_highlight_runs` rows from the auto-highlight pipeline —
 * those already carry their own instruction / summary).
 */

export interface PaperHighlightLike {
  runId?: string | null;
  noteMd: string | null;
}

export interface ChatAgentRun {
  id: string;
  instruction: string;
  summary: string | null;
  highlightCount: number;
}

const DEFAULT_LABEL = "Highlight run";
const MAX_LABEL_LEN = 120;

export function deriveChatAgentRuns(
  paperHighlights: PaperHighlightLike[],
  autoRunIds: Iterable<string>,
): ChatAgentRun[] {
  const counts = new Map<string, number>();
  const firstNote = new Map<string, string>();
  for (const h of paperHighlights) {
    const rid = h.runId ?? null;
    if (!rid) continue;
    counts.set(rid, (counts.get(rid) ?? 0) + 1);
    if (!firstNote.has(rid) && h.noteMd && h.noteMd.trim()) {
      firstNote.set(rid, h.noteMd.trim());
    }
  }
  const known = new Set(autoRunIds);
  const runs: ChatAgentRun[] = [];
  for (const [id, n] of counts) {
    if (known.has(id)) continue;
    const note = firstNote.get(id);
    const label = note
      ? note.split(/\r?\n/)[0].slice(0, MAX_LABEL_LEN)
      : DEFAULT_LABEL;
    runs.push({
      id,
      instruction: label,
      summary: note ?? null,
      highlightCount: n,
    });
  }
  return runs;
}

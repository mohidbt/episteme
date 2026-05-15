/**
 * Round E — collapse chat-agent paper_highlights rows that share the same
 * `runId`, page, and bbox (within ±2 px). The chat-agent `highlight()` tool
 * can be invoked multiple times in one agent run, producing visually
 * duplicate sidebar entries. Merge notes with " · " separator (deduped).
 *
 * Rows without a runId are passed through unchanged — we have no safe
 * grouping key for them.
 */

export interface BBoxLite {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  page?: number;
}

export interface PaperHighlightRowLite {
  id: string;
  page: number;
  bbox: unknown;
  noteMd: string | null;
  runId?: string | null;
  toolCallId?: string | null;
  createdAt: string;
}

const BBOX_TOLERANCE_PX = 2;
const NOTE_SEPARATOR = " · ";

function firstRect(bbox: unknown): BBoxLite | null {
  const one = (v: unknown): BBoxLite | null => {
    if (!v || typeof v !== "object") return null;
    const o = v as Record<string, unknown>;
    const x0 = Number(o.x0);
    const y0 = Number(o.y0);
    const x1 = Number(o.x1);
    const y1 = Number(o.y1);
    if (![x0, y0, x1, y1].every(Number.isFinite)) return null;
    return { x0, y0, x1, y1 };
  };
  if (Array.isArray(bbox)) return bbox.length > 0 ? one(bbox[0]) : null;
  return one(bbox);
}

function bboxEquivalent(a: BBoxLite | null, b: BBoxLite | null, tol = BBOX_TOLERANCE_PX): boolean {
  if (!a || !b) return a === b;
  return (
    Math.abs(a.x0 - b.x0) <= tol &&
    Math.abs(a.y0 - b.y0) <= tol &&
    Math.abs(a.x1 - b.x1) <= tol &&
    Math.abs(a.y1 - b.y1) <= tol
  );
}

export function dedupPaperHighlights<T extends PaperHighlightRowLite>(rows: T[]): T[] {
  const out: T[] = [];
  // Track index in `out` of each runId's groups so we can merge.
  const groupIdx = new Map<string, number[]>();

  for (const row of rows) {
    const rid = row.runId ?? null;
    if (!rid) {
      out.push(row);
      continue;
    }
    const key = `${rid}::${row.page}`;
    const candidates = groupIdx.get(key) ?? [];
    const rowRect = firstRect(row.bbox);
    let merged = false;
    for (const i of candidates) {
      const existing = out[i];
      if (bboxEquivalent(firstRect(existing.bbox), rowRect)) {
        // Merge notes: dedupe, preserve order.
        const existingNotes = existing.noteMd
          ? existing.noteMd.split(NOTE_SEPARATOR)
          : [];
        const newNote = (row.noteMd ?? "").trim();
        if (newNote && !existingNotes.includes(newNote)) {
          existingNotes.push(newNote);
        }
        const filtered = existingNotes.map((s) => s.trim()).filter(Boolean);
        out[i] = {
          ...existing,
          noteMd: filtered.length > 0 ? filtered.join(NOTE_SEPARATOR) : existing.noteMd,
        } as T;
        merged = true;
        break;
      }
    }
    if (!merged) {
      const idx = out.length;
      out.push(row);
      groupIdx.set(key, [...candidates, idx]);
    }
  }

  return out;
}

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

// Bbox coordinate contract: rects are raw PDF user-space coordinates as
// emitted by the chat-agent `highlight()` tool. The ±2 px tolerance below
// assumes producers normalize to the same coordinate space; sub-pixel drift
// across repeated tool calls is the only expected source of variation.
const BBOX_TOLERANCE_PX = 2;
const NOTE_SEPARATOR = " · ";

function parseOne(v: unknown): BBoxLite | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const x0 = Number(o.x0);
  const y0 = Number(o.y0);
  const x1 = Number(o.x1);
  const y1 = Number(o.y1);
  if (![x0, y0, x1, y1].every(Number.isFinite)) return null;
  return { x0, y0, x1, y1 };
}

type ParsedBBox =
  | { kind: "single"; rect: BBoxLite | null }
  | { kind: "array"; rects: Array<BBoxLite | null> };

function parseBBox(bbox: unknown): ParsedBBox {
  if (Array.isArray(bbox)) return { kind: "array", rects: bbox.map(parseOne) };
  return { kind: "single", rect: parseOne(bbox) };
}

function bboxesEquivalent(a: ParsedBBox, b: ParsedBBox): boolean {
  // Different container shapes (array vs single object) describe different
  // highlight geometries even when the leading rect happens to match.
  if (a.kind !== b.kind) return false;
  if (a.kind === "single" && b.kind === "single") {
    return bboxEquivalent(a.rect, b.rect);
  }
  if (a.kind === "array" && b.kind === "array") {
    if (a.rects.length !== b.rects.length) return false;
    return a.rects.every((rect, i) => bboxEquivalent(rect, b.rects[i]));
  }
  return false;
}

function bboxEquivalent(a: BBoxLite | null, b: BBoxLite | null, tol = BBOX_TOLERANCE_PX): boolean {
  // Null / malformed rects carry no positional evidence — treat as NOT
  // equivalent so we don't collapse unrelated rows that happen to lack bbox.
  if (!a || !b) return false;
  return (
    Math.abs(a.x0 - b.x0) <= tol &&
    Math.abs(a.y0 - b.y0) <= tol &&
    Math.abs(a.x1 - b.x1) <= tol &&
    Math.abs(a.y1 - b.y1) <= tol
  );
}

export function dedupPaperHighlights<T extends PaperHighlightRowLite>(rows: T[]): T[] {
  const out: T[] = [];
  // For each merged output slot, accumulate notes in order with a Set guarding
  // duplicates. Joining once at the end avoids ever splitting on the display
  // separator — so a real note that happens to contain " · " round-trips intact.
  const notesByIdx = new Map<number, { order: string[]; seen: Set<string> }>();
  // Track index in `out` of each runId's groups so we can merge.
  const groupIdx = new Map<string, number[]>();

  const pushNote = (idx: number, note: string | null) => {
    const trimmed = (note ?? "").trim();
    if (!trimmed) return;
    let bucket = notesByIdx.get(idx);
    if (!bucket) {
      bucket = { order: [], seen: new Set() };
      notesByIdx.set(idx, bucket);
    }
    if (!bucket.seen.has(trimmed)) {
      bucket.seen.add(trimmed);
      bucket.order.push(trimmed);
    }
  };

  for (const row of rows) {
    const rid = row.runId ?? null;
    if (!rid) {
      out.push(row);
      continue;
    }
    const key = `${rid}::${row.page}`;
    const candidates = groupIdx.get(key) ?? [];
    const rowParsed = parseBBox(row.bbox);
    let mergedIdx: number | null = null;
    for (const i of candidates) {
      if (bboxesEquivalent(parseBBox(out[i].bbox), rowParsed)) {
        mergedIdx = i;
        break;
      }
    }
    if (mergedIdx === null) {
      const idx = out.length;
      out.push(row);
      groupIdx.set(key, [...candidates, idx]);
      pushNote(idx, row.noteMd);
    } else {
      pushNote(mergedIdx, row.noteMd);
    }
  }

  for (const [idx, bucket] of notesByIdx) {
    if (bucket.order.length === 0) continue;
    out[idx] = {
      ...out[idx],
      noteMd: bucket.order.join(NOTE_SEPARATOR),
    } as T;
  }

  return out;
}

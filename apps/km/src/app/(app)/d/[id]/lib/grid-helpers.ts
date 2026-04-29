export type ColumnSpec = { name: string; description: string };
export type RowRef = { paper_id: string };
export type CellGrounding = Record<
  string,
  Record<string, { paper_id: string; block_ids: string[] }>
>;
export type RunningCell = { row: number; col: string };
export type CellState =
  | { kind: "empty" }
  | { kind: "filled"; value: string; firstPage: number | null }
  | { kind: "running" }
  | { kind: "failed"; message: string };

export function cellKey(row: number, col: string): string {
  return `${row}:${col}`;
}

/**
 * Derive the visible state for a single grid cell.
 *
 * Priority: running > failed > filled > empty.
 *
 * `cellValues` is a flat map "row:col" → string value parsed from the
 * paperset's `content` CSV. (For T10 we only render whatever the API has
 * already streamed in via `cell_update` events; we don't parse the CSV.)
 */
export function deriveCellState(
  row: number,
  col: string,
  opts: {
    runningKeys: Set<string>;
    failedKeys: Map<string, string>;
    cellValues: Map<string, string>;
    grounding: CellGrounding;
  },
): CellState {
  const k = cellKey(row, col);
  if (opts.runningKeys.has(k)) return { kind: "running" };
  const failedMsg = opts.failedKeys.get(k);
  if (failedMsg) return { kind: "failed", message: failedMsg };
  const value = opts.cellValues.get(k);
  if (value !== undefined) {
    const ground = opts.grounding[String(row)]?.[col];
    const firstPage =
      ground && ground.block_ids.length > 0
        ? extractPageHint(ground.block_ids[0])
        : null;
    return { kind: "filled", value, firstPage };
  }
  return { kind: "empty" };
}

/**
 * Block ids look like "block_<paperId>_p<page>_<idx>". Best-effort extract
 * the page number; return null if we can't parse one.
 */
function extractPageHint(blockId: string): number | null {
  const m = blockId.match(/_p(\d+)_/);
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

export function buildFilledKeys(
  cellValues: Map<string, string>,
): Set<string> {
  return new Set(cellValues.keys());
}

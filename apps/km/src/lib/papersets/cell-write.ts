/**
 * Pure helper for csv_write_cell — applies a single-cell update to a
 * paperset's `content` (CSV text) and `cellGrounding` map.
 *
 * Server-side guards (per Phase 1.4.x T4):
 *   - cell currently empty (idempotent retry: same value accepted)
 *   - grounding.block_ids non-empty for non-"n/a" values
 *   - row in range(len(rowRefs)); col in column names
 */

export type ColumnSpec = { name: string; description: string };
export type RowRef = { paper_id: string };
export type Grounding = { paper_id: string; block_ids: string[] };
export type CellGrounding = Record<string, Record<string, Grounding>>;

export interface CellWriteInput {
  row: number;
  col: string;
  value: string;
  grounding: Grounding;
}

export interface PapersetSlice {
  columns: ColumnSpec[];
  rowRefs: RowRef[];
  content: string;
  cellGrounding: CellGrounding;
}

export type CellWriteError =
  | "row_oob"
  | "unknown_col"
  | "cell_filled"
  | "grounding_required";

export type CellWriteResult =
  | { ok: true; content: string; cellGrounding: CellGrounding }
  | { ok: false; error: CellWriteError };

function csvEscape(field: string): string {
  if (/[",\n]/.test(field)) return `"${field.replace(/"/g, '""')}"`;
  return field;
}

/** Minimal RFC4180 row parser — handles quoted fields with commas + escaped quotes. */
function parseCsvRow(line: string): string[] {
  const fields: string[] = [];
  let i = 0;
  let cur = "";
  let inQuotes = false;
  while (i < line.length) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 2;
        continue;
      }
      if (ch === '"') {
        inQuotes = false;
        i += 1;
        continue;
      }
      cur += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      fields.push(cur);
      cur = "";
      i += 1;
      continue;
    }
    cur += ch;
    i += 1;
  }
  fields.push(cur);
  return fields;
}

/**
 * Parse the CSV `content` into a `{row:col => value}` dict.
 * Header row is skipped; first column ("Reference") is excluded.
 */
export function parseCsvCells(
  content: string,
  columns: ColumnSpec[],
): Record<string, string> {
  if (!content.trim()) return {};
  const lines = content.split("\n");
  if (lines.length < 2) return {};
  const out: Record<string, string> = {};
  for (let r = 1; r < lines.length; r++) {
    const fields = parseCsvRow(lines[r]);
    for (let c = 0; c < columns.length; c++) {
      const v = fields[c + 1] ?? "";
      if (v !== "") out[`${r - 1}:${columns[c].name}`] = v;
    }
  }
  return out;
}

/**
 * Build CSV content from refs + columns + cells dict.
 * Header is `Reference,<col1>,<col2>,…`. Each subsequent line corresponds to
 * one rowRef, with the cell value (or empty string) for each column.
 */
export function regenerateCsv(
  refs: RowRef[],
  columns: ColumnSpec[],
  cells: Record<string, string>,
): string {
  const header = ["Reference", ...columns.map((c) => c.name)]
    .map(csvEscape)
    .join(",");
  const lines = [header];
  for (let r = 0; r < refs.length; r++) {
    const row = [refs[r].paper_id];
    for (const col of columns) {
      row.push(cells[`${r}:${col.name}`] ?? "");
    }
    lines.push(row.map(csvEscape).join(","));
  }
  return lines.join("\n");
}

export function applyCellWrite(
  paperset: PapersetSlice,
  input: CellWriteInput,
): CellWriteResult {
  const { row, col, value, grounding } = input;

  if (row < 0 || row >= paperset.rowRefs.length) return { ok: false, error: "row_oob" };
  if (!paperset.columns.some((c) => c.name === col)) return { ok: false, error: "unknown_col" };
  if (value !== "n/a" && grounding.block_ids.length === 0) {
    return { ok: false, error: "grounding_required" };
  }

  const cells = parseCsvCells(paperset.content, paperset.columns);
  const key = `${row}:${col}`;
  const existing = cells[key];
  if (existing && existing !== value) return { ok: false, error: "cell_filled" };

  cells[key] = value;
  const content = regenerateCsv(paperset.rowRefs, paperset.columns, cells);

  const cellGrounding: CellGrounding = {
    ...paperset.cellGrounding,
    [String(row)]: {
      ...(paperset.cellGrounding[String(row)] ?? {}),
      [col]: grounding,
    },
  };

  return { ok: true, content, cellGrounding };
}

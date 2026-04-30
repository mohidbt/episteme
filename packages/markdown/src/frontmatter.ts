/**
 * Tiny YAML frontmatter parser/serializer for note property rows.
 *
 * Supports a constrained subset:
 *   - key followed by colon then value
 *   - bracketed array literals
 *   - quoted string values (single or double)
 *
 * Anything richer (block sequences, nested maps) is out of scope. Notes are
 * the only consumer; if a note has malformed frontmatter we fall back to
 * treating the body as plain markdown.
 */

export type FrontmatterValue = string | number | string[];

export type FrontmatterRow = {
  key: string;
  value: FrontmatterValue;
  /** Inferred type for UI rendering. */
  type: "date" | "number" | "tags" | "text";
};

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function inferType(value: FrontmatterValue): FrontmatterRow["type"] {
  if (Array.isArray(value)) return "tags";
  if (typeof value === "number") return "number";
  if (typeof value === "string" && ISO_DATE_RE.test(value)) return "date";
  return "text";
}

function unquote(s: string): string {
  if (s.length >= 2) {
    const a = s[0];
    const b = s[s.length - 1];
    if ((a === '"' && b === '"') || (a === "'" && b === "'")) {
      return s.slice(1, -1);
    }
  }
  return s;
}

function parseScalar(raw: string): string | number {
  const trimmed = raw.trim();
  if (trimmed === "") return "";
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    const n = Number(trimmed);
    if (Number.isFinite(n)) return n;
  }
  return unquote(trimmed);
}

function parseArray(raw: string): string[] {
  const inner = raw.slice(1, -1);
  if (inner.trim() === "") return [];
  return inner
    .split(",")
    .map((s) => unquote(s.trim()))
    .filter((s) => s.length > 0);
}

export function splitFrontmatter(source: string): {
  raw: string | null;
  body: string;
} {
  if (!source.startsWith("---\n") && !source.startsWith("---\r\n")) {
    return { raw: null, body: source };
  }
  const afterFirst = source.indexOf("\n") + 1;
  const rest = source.slice(afterFirst);
  const closeRe = /\n---[ \t]*(?:\r?\n|$)/;
  const closeMatch = closeRe.exec(rest);
  if (!closeMatch) return { raw: null, body: source };
  const raw = rest.slice(0, closeMatch.index);
  const bodyStart = afterFirst + closeMatch.index + closeMatch[0].length;
  return { raw, body: source.slice(bodyStart) };
}

export function parseFrontmatterRows(raw: string): FrontmatterRow[] {
  const rows: FrontmatterRow[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const valueRaw = line.slice(idx + 1).trim();
    let value: FrontmatterValue;
    if (valueRaw.startsWith("[") && valueRaw.endsWith("]")) {
      value = parseArray(valueRaw);
    } else {
      value = parseScalar(valueRaw);
    }
    rows.push({ key, value, type: inferType(value) });
  }
  return rows;
}

export function parseFrontmatter(source: string): {
  rows: FrontmatterRow[];
  body: string;
} {
  const { raw, body } = splitFrontmatter(source);
  if (raw === null) return { rows: [], body };
  return { rows: parseFrontmatterRows(raw), body };
}

function serializeValue(value: FrontmatterValue): string {
  if (Array.isArray(value)) {
    return `[${value.join(", ")}]`;
  }
  if (typeof value === "number") return String(value);
  if (/^[\[{]/.test(value) || /:\s/.test(value)) {
    return `"${value.replace(/"/g, '\\"')}"`;
  }
  return value;
}

export function serializeFrontmatterRows(rows: FrontmatterRow[]): string {
  return rows.map((r) => `${r.key}: ${serializeValue(r.value)}`).join("\n");
}

export function buildMarkdownWithFrontmatter(
  rows: FrontmatterRow[],
  body: string,
): string {
  if (rows.length === 0) return body;
  return `---\n${serializeFrontmatterRows(rows)}\n---\n${body}`;
}

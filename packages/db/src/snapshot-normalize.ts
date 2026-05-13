/**
 * Normalize a `pg_dump --schema-only` output so it can be diffed
 * deterministically against a checked-in baseline.
 *
 * Strips:
 *  - `--` line comments
 *  - top-level `SET ...;` session config emitted by pg_dump
 *  - blank lines
 *  - trailing whitespace
 *
 * Preserves function bodies (which may legitimately contain their own
 * `SET search_path = public;`), CREATE TABLE / INDEX / CONSTRAINT / TYPE /
 * TRIGGER / POLICY, ALTER, etc.
 *
 * Function bodies are detected via `$tag$ ... $tag$` dollar-quote pairs
 * (including the unnamed `$$`). SET lines inside a body are preserved.
 *
 * Idempotent: normalize(normalize(x)) === normalize(x).
 */
export function normalizeDump(input: string): string {
  // Mark byte ranges falling inside dollar-quoted function bodies.
  const bodyRanges: Array<[number, number]> = [];
  const tagRe = /\$([A-Za-z_][A-Za-z0-9_]*)?\$/g;
  let match: RegExpExecArray | null;
  let openIdx = -1;
  let openTag = "";
  while ((match = tagRe.exec(input)) !== null) {
    const tag = match[1] ?? "";
    if (openIdx < 0) {
      openIdx = match.index;
      openTag = tag;
    } else if (tag === openTag) {
      bodyRanges.push([openIdx, match.index + match[0].length]);
      openIdx = -1;
      openTag = "";
    }
  }

  const inBody = (offset: number): boolean => {
    for (const [s, e] of bodyRanges) {
      if (offset >= s && offset < e) return true;
    }
    return false;
  };

  const out: string[] = [];
  let cursor = 0;
  const lines = input.split("\n");
  for (const raw of lines) {
    const lineStart = cursor;
    cursor += raw.length + 1;

    const line = raw.replace(/[ \t]+$/, "");
    if (line.length === 0) continue;
    const trimmed = line.trimStart();
    if (trimmed.startsWith("--")) continue;
    if (/^SET\s[^;]*;$/i.test(trimmed) && !inBody(lineStart)) continue;
    out.push(line);
  }
  return out.join("\n") + (out.length > 0 ? "\n" : "");
}

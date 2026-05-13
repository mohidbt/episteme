/**
 * Normalize a `pg_dump --schema-only` output so it can be diffed
 * deterministically against a checked-in baseline.
 *
 * Strips:
 *  - `--` line comments (including the trailing newline)
 *  - `SET ...;` statements (idempotent connection params pg_dump emits)
 *  - blank lines
 *  - trailing whitespace on each remaining line
 *
 * Preserves semantic content: CREATE TABLE / INDEX / CONSTRAINT /
 * FUNCTION / TYPE / TRIGGER / POLICY bodies, ALTER statements, etc.
 *
 * Idempotent: normalize(normalize(x)) === normalize(x).
 */
export function normalizeDump(input: string): string {
  const lines = input.split("\n");
  const out: string[] = [];
  for (const raw of lines) {
    const line = raw.replace(/[ \t]+$/, "");
    if (line.length === 0) continue;
    const trimmed = line.trimStart();
    if (trimmed.startsWith("--")) continue;
    if (/^SET\s[^;]*;$/i.test(trimmed)) continue;
    out.push(line);
  }
  return out.join("\n") + (out.length > 0 ? "\n" : "");
}

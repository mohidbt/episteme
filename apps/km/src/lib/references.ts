// Helpers for /api/references: unique-collision suggestion + 23505 detection.

/**
 * Given a citation key, produce the next "-N" suggestion.
 * - "foo"     -> "foo-2"
 * - "foo-2"   -> "foo-3"
 * - "foo-10"  -> "foo-11"
 */
export function suggestNextCitationKey(key: string): string {
  const m = key.match(/^(.+)-(\d+)$/);
  if (m) {
    const base = m[1];
    const n = Number.parseInt(m[2], 10);
    return `${base}-${n + 1}`;
  }
  return `${key}-2`;
}

/**
 * Detects Postgres unique-violation errors (SQLSTATE 23505).
 *
 * The `postgres` (postgres-js) driver throws PostgresError with `.code` set
 * directly. Drizzle wraps those in its own `DrizzleQueryError` and preserves
 * the original via `.cause`. Check both.
 */
export function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const direct = (err as { code?: unknown }).code;
  if (direct === "23505") return true;
  const cause = (err as { cause?: unknown }).cause;
  if (typeof cause === "object" && cause !== null && (cause as { code?: unknown }).code === "23505") {
    return true;
  }
  return false;
}

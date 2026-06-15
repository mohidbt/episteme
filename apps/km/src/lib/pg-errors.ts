// Postgres error-code helpers. Centralised so callers don't reach into
// driver-specific string messages — those vary between postgres-js and
// drizzle's wrapped DrizzleQueryError.

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
  if (
    typeof cause === "object" &&
    cause !== null &&
    (cause as { code?: unknown }).code === "23505"
  ) {
    return true;
  }
  return false;
}

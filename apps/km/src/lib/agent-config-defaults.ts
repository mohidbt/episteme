// #63 — Runtime default model for newly-created agent_configs rows.
//
// We read DEFAULT_AGENT_MODEL from the environment so the operator can
// re-configure the default in Vercel's dashboard without a deploy or DB
// migration. The drizzle schema-level default still exists as a static
// safety net (matches the fallback below), but at insert time we always
// override with the env value when set — that way a Vercel env change
// takes effect on the next new-row creation, not whenever schema is next
// migrated.
//
// Existing rows are intentionally untouched; this only governs new inserts.

const FALLBACK_MODEL = "google/gemma-4-26b-a4b-it";

export function getDefaultAgentModel(): string {
  const v = process.env.DEFAULT_AGENT_MODEL;
  if (typeof v === "string" && v.trim().length > 0) return v.trim();
  return FALLBACK_MODEL;
}

/**
 * Pure per-row decision for the JATS paper-abstract backfill.
 *
 * Extracted from `scripts/backfill-jats-paper-abstracts.ts` so it's
 * unit-testable without a live DB connection. See plan
 * `docs/superpowers/plans/jats-paper-backfill.md`.
 */
import { sanitizeAbstract } from "../strip-jats";

export interface RewriteDecision {
  rewrite: boolean;
  clean: string;
}

/**
 * Decide whether a paper's `abstract_short` value needs rewriting.
 *
 * Returns `rewrite: false` when the sanitized value matches the raw input
 * (already clean) or when the raw input is null/empty.
 */
export function shouldRewriteAbstract(raw: string | null): RewriteDecision {
  if (raw == null) return { rewrite: false, clean: "" };
  const clean = sanitizeAbstract(raw);
  return { rewrite: clean !== raw, clean };
}

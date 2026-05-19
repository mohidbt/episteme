/**
 * Audit: recompute `openrouter_usage.cost_usd` from current catalog prices
 * and tokens, compare to the stored value.
 *
 * Validates that `recordUsage()` produced consistent cost numbers at write
 * time. Does NOT validate against OpenRouter's authoritative per-call
 * `/api/v1/generation` cost — that needs a `generation_id` column the
 * schema doesn't carry yet (Phase B follow-up).
 *
 * Read-only. Reports total / match / mismatch / catalog-missing tallies and
 * up to 20 mismatch examples.
 *
 * Usage (from apps/km, read DATABASE_URL from env):
 *   pnpm --filter km tsx scripts/audit-openrouter-usage-cost.ts
 *
 * Env:
 *   DATABASE_URL (or APP_RUNTIME_DATABASE_URL) — Postgres DSN with SELECT
 *     on openrouter_usage + openrouter_catalog.
 */

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { openrouterCatalog, openrouterUsage } from "@episteme/db/schema";

export const EPSILON_USD = 0.000001;

export interface UsageRow {
  id: number;
  model: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: string;
}

export interface CatalogPayload {
  pricing?: { prompt?: string; completion?: string };
  [k: string]: unknown;
}

export interface Mismatch {
  id: number;
  model: string;
  recorded: number;
  recomputed: number;
  delta: number;
}

export interface AuditTally {
  total: number;
  match: number;
  mismatch: number;
  catalogMissing: number;
  examples: Mismatch[];
}

/**
 * Pure comparator: recompute cost from catalog × tokens, compare against
 * the recorded `cost_usd` string. Returns the verdict bucket and a delta
 * value when applicable. Catalog-missing dominates — without a price we
 * cannot recompute, so the row is reported separately.
 */
export function compareCostRow(
  row: UsageRow,
  catalog: CatalogPayload | null,
): { verdict: "match" | "mismatch" | "catalog-missing"; mismatch?: Mismatch } {
  if (!catalog) return { verdict: "catalog-missing" };
  const promptPrice = Number(catalog.pricing?.prompt);
  const completionPrice = Number(catalog.pricing?.completion);
  const recomputed =
    (Number.isFinite(promptPrice) ? row.promptTokens * promptPrice : 0) +
    (Number.isFinite(completionPrice)
      ? row.completionTokens * completionPrice
      : 0);
  const recorded = Number(row.costUsd);
  const delta = recomputed - recorded;
  if (Math.abs(delta) <= EPSILON_USD) return { verdict: "match" };
  return {
    verdict: "mismatch",
    mismatch: {
      id: row.id,
      model: row.model,
      recorded,
      recomputed,
      delta,
    },
  };
}

async function main() {
  const rows: UsageRow[] = await db
    .select({
      id: openrouterUsage.id,
      model: openrouterUsage.model,
      promptTokens: openrouterUsage.promptTokens,
      completionTokens: openrouterUsage.completionTokens,
      costUsd: openrouterUsage.costUsd,
    })
    .from(openrouterUsage);

  const catalogCache = new Map<string, CatalogPayload | null>();
  async function getCatalog(model: string): Promise<CatalogPayload | null> {
    if (catalogCache.has(model)) return catalogCache.get(model) ?? null;
    const r = await db
      .select({ payload: openrouterCatalog.payload })
      .from(openrouterCatalog)
      .where(eq(openrouterCatalog.modelId, model))
      .limit(1);
    const payload = (r[0]?.payload ?? null) as CatalogPayload | null;
    catalogCache.set(model, payload);
    return payload;
  }

  const tally: AuditTally = {
    total: 0,
    match: 0,
    mismatch: 0,
    catalogMissing: 0,
    examples: [],
  };

  for (const row of rows) {
    tally.total++;
    const payload = await getCatalog(row.model);
    const v = compareCostRow(row, payload);
    if (v.verdict === "match") tally.match++;
    else if (v.verdict === "catalog-missing") tally.catalogMissing++;
    else {
      tally.mismatch++;
      if (v.mismatch && tally.examples.length < 20)
        tally.examples.push(v.mismatch);
    }
  }

  console.log("[audit-or-usage] DONE");
  console.log(`  total            = ${tally.total}`);
  console.log(`  match            = ${tally.match}`);
  console.log(`  mismatch         = ${tally.mismatch}`);
  console.log(`  catalog missing  = ${tally.catalogMissing}`);
  if (tally.examples.length > 0) {
    console.log("[audit-or-usage] mismatch examples (first 20):");
    for (const ex of tally.examples) {
      console.log(
        `  id=${ex.id} model=${ex.model} recorded=${ex.recorded.toFixed(6)} recomputed=${ex.recomputed.toFixed(6)} delta=${ex.delta.toFixed(6)}`,
      );
    }
  }
}

const invokedDirectly = (() => {
  const arg = process.argv[1] ?? "";
  // Match the script file but not its test sibling — the test imports this
  // module and would otherwise trigger main() during `node --test`.
  return /audit-openrouter-usage-cost\.ts$/.test(arg);
})();
if (invokedDirectly) {
  main().catch((e) => {
    console.error("[audit-or-usage] fatal:", e);
    process.exit(1);
  });
}

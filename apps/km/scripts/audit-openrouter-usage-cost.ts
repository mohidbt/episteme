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
  createdAt?: Date | null;
}

export interface CatalogPayload {
  pricing?: { prompt?: string; completion?: string };
  [k: string]: unknown;
}

export interface CatalogEntry {
  payload: CatalogPayload;
  fetchedAt: Date | null;
}

export interface Mismatch {
  id: number;
  model: string;
  recorded: number;
  recomputed: number;
  delta: number;
  /** Catalog has been refreshed after the usage row → cannot distinguish
   *  formula bug from honest price drift. */
  likelyDrift: boolean;
}

export type Verdict =
  | "match"
  | "mismatch-formula"
  | "mismatch-drift"
  | "catalog-missing";

export interface AuditTally {
  total: number;
  match: number;
  mismatchFormula: number;
  mismatchDrift: number;
  catalogMissing: number;
  examples: Mismatch[];
}

/**
 * Pure comparator: recompute cost from catalog × tokens, compare against
 * the recorded `cost_usd` string. Returns the verdict bucket and a delta
 * value when applicable. Catalog-missing dominates — without a price we
 * cannot recompute, so the row is reported separately.
 *
 * `openrouter_catalog` is mutable (it gets upserted on every refresh), so
 * a mismatch could mean either a real `recordUsage()` formula bug OR
 * legitimate price drift between write-time and now. We disambiguate by
 * comparing `catalog.fetchedAt` to `row.createdAt`: catalog newer than
 * row → `mismatch-drift` (warning), otherwise `mismatch-formula` (bug).
 * When either timestamp is missing we conservatively treat it as drift.
 */
export function compareCostRow(
  row: UsageRow,
  catalog: CatalogEntry | null,
): { verdict: Verdict; mismatch?: Mismatch } {
  if (!catalog) return { verdict: "catalog-missing" };
  const promptPrice = Number(catalog.payload.pricing?.prompt);
  const completionPrice = Number(catalog.payload.pricing?.completion);
  const recomputed =
    (Number.isFinite(promptPrice) ? row.promptTokens * promptPrice : 0) +
    (Number.isFinite(completionPrice)
      ? row.completionTokens * completionPrice
      : 0);
  const recorded = Number(row.costUsd);
  const delta = recomputed - recorded;
  if (Math.abs(delta) <= EPSILON_USD) return { verdict: "match" };

  const rowTime = row.createdAt?.getTime();
  const catalogTime = catalog.fetchedAt?.getTime();
  const likelyDrift =
    rowTime == null || catalogTime == null || catalogTime > rowTime;
  return {
    verdict: likelyDrift ? "mismatch-drift" : "mismatch-formula",
    mismatch: {
      id: row.id,
      model: row.model,
      recorded,
      recomputed,
      delta,
      likelyDrift,
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
      createdAt: openrouterUsage.createdAt,
    })
    .from(openrouterUsage);

  const catalogCache = new Map<string, CatalogEntry | null>();
  async function getCatalog(model: string): Promise<CatalogEntry | null> {
    if (catalogCache.has(model)) return catalogCache.get(model) ?? null;
    const r = await db
      .select({
        payload: openrouterCatalog.payload,
        fetchedAt: openrouterCatalog.fetchedAt,
      })
      .from(openrouterCatalog)
      .where(eq(openrouterCatalog.modelId, model))
      .limit(1);
    const entry: CatalogEntry | null = r[0]
      ? {
          payload: (r[0].payload ?? {}) as CatalogPayload,
          fetchedAt: r[0].fetchedAt,
        }
      : null;
    catalogCache.set(model, entry);
    return entry;
  }

  const tally: AuditTally = {
    total: 0,
    match: 0,
    mismatchFormula: 0,
    mismatchDrift: 0,
    catalogMissing: 0,
    examples: [],
  };

  for (const row of rows) {
    tally.total++;
    const entry = await getCatalog(row.model);
    const v = compareCostRow(row, entry);
    if (v.verdict === "match") tally.match++;
    else if (v.verdict === "catalog-missing") tally.catalogMissing++;
    else if (v.verdict === "mismatch-drift") {
      tally.mismatchDrift++;
      if (v.mismatch && tally.examples.length < 20)
        tally.examples.push(v.mismatch);
    } else {
      tally.mismatchFormula++;
      if (v.mismatch && tally.examples.length < 20)
        tally.examples.push(v.mismatch);
    }
  }

  console.log("[audit-or-usage] DONE");
  console.log(`  total              = ${tally.total}`);
  console.log(`  match              = ${tally.match}`);
  console.log(`  mismatch (formula) = ${tally.mismatchFormula}  <- real bugs`);
  console.log(`  mismatch (drift)   = ${tally.mismatchDrift}    <- catalog newer than row`);
  console.log(`  catalog missing    = ${tally.catalogMissing}`);
  if (tally.examples.length > 0) {
    console.log("[audit-or-usage] mismatch examples (first 20):");
    for (const ex of tally.examples) {
      const tag = ex.likelyDrift ? "drift" : "formula";
      console.log(
        `  [${tag}] id=${ex.id} model=${ex.model} recorded=${ex.recorded.toFixed(6)} recomputed=${ex.recomputed.toFixed(6)} delta=${ex.delta.toFixed(6)}`,
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

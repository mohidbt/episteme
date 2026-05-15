// Round C — per-identity OpenRouter spend audit.
//
// Two helpers:
//   • recordUsage()         — insert one row per call. Cost = catalog price
//                             × tokens. Defensive on missing catalog rows.
//   • getRecentSpendUsd()   — sum + per-model breakdown over the last N days
//                             for one identity (user XOR guest).
//
// Identity rule: callers pass `userId` (signed-in) OR `guestSessionId` (anon).
// Exactly one should be non-null. Guest rows are NEVER transferred to a user
// on signup — separate audit trail by design.
//
// Soft limits: $5 for signed-in, $1 for guest. Enforced as warn-only in
// the UI; no server-side block.

import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { openrouterCatalog, openrouterUsage } from "@episteme/db/schema";

export const OR_USER_SOFT_LIMIT_USD = 5;
export const OR_GUEST_SOFT_LIMIT_USD = 1;

export interface RecordUsageInput {
  userId: string | null;
  guestSessionId: string | null;
  model: string;
  promptTokens: number;
  completionTokens: number;
  /** Free-form tag — 'ai-fill' | 'km-agent' | etc. */
  source: string;
}

interface CatalogPayload {
  pricing?: { prompt?: string; completion?: string };
  [k: string]: unknown;
}

/**
 * Look up `model` in the openrouter_catalog cache and compute the USD cost
 * for the given token counts. Returns 0 when the model is absent OR when
 * pricing fields are missing/unparseable — never throws on bad catalog data,
 * so a one-off OpenRouter catalog gap doesn't break the call site.
 */
async function computeCostUsd(
  model: string,
  promptTokens: number,
  completionTokens: number,
): Promise<number> {
  const rows = await db
    .select({ payload: openrouterCatalog.payload })
    .from(openrouterCatalog)
    .where(eq(openrouterCatalog.modelId, model))
    .limit(1);
  const payload = (rows[0]?.payload ?? null) as CatalogPayload | null;
  const promptPrice = Number(payload?.pricing?.prompt);
  const completionPrice = Number(payload?.pricing?.completion);
  const promptCost = Number.isFinite(promptPrice)
    ? promptTokens * promptPrice
    : 0;
  const completionCost = Number.isFinite(completionPrice)
    ? completionTokens * completionPrice
    : 0;
  return promptCost + completionCost;
}

export async function recordUsage(input: RecordUsageInput): Promise<void> {
  const costUsd = await computeCostUsd(
    input.model,
    input.promptTokens,
    input.completionTokens,
  );
  // Clamp to 6 decimal places — matches the numeric(10,6) column.
  const costStr = costUsd.toFixed(6);
  await db.insert(openrouterUsage).values({
    userId: input.userId,
    guestSessionId: input.guestSessionId,
    model: input.model,
    promptTokens: input.promptTokens,
    completionTokens: input.completionTokens,
    costUsd: costStr,
    source: input.source,
  });
}

export interface RecentSpend {
  totalUsd: number;
  byModel: Array<{ model: string; usd: number }>;
}

export async function getRecentSpendUsd(
  userId: string | null,
  guestId: string | null,
  days = 30,
): Promise<RecentSpend> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  // Identity scope: one of userId / guestId is set; the other is matched
  // against NULL so we never bleed across identities.
  const identityCond = userId
    ? and(
        eq(openrouterUsage.userId, userId),
        isNull(openrouterUsage.guestSessionId),
      )
    : guestId
      ? and(
          eq(openrouterUsage.guestSessionId, guestId),
          isNull(openrouterUsage.userId),
        )
      : // Neither — return no rows.
        sql`false`;

  const totalExpr = sql<string>`COALESCE(SUM(${openrouterUsage.costUsd}), 0)::text`;
  const rows = await db
    .select({
      model: openrouterUsage.model,
      usd: totalExpr,
    })
    .from(openrouterUsage)
    .where(and(identityCond, gte(openrouterUsage.createdAt, since)))
    .groupBy(openrouterUsage.model)
    .orderBy(desc(totalExpr));

  const byModel = rows.map((r) => ({ model: r.model, usd: Number(r.usd) }));
  const totalUsd = byModel.reduce((acc, b) => acc + b.usd, 0);
  return { totalUsd, byModel };
}

/**
 * Tests for the pure cost-recompute comparator.
 *
 * Run with:
 *   node --test --import tsx scripts/audit-openrouter-usage-cost.test.ts
 *
 * Uses node:test (not vitest) because vitest's include glob is scoped to
 * `src/**` — keeps scripts/ self-contained without widening that glob.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compareCostRow,
  EPSILON_USD,
  type CatalogEntry,
  type UsageRow,
} from "./audit-openrouter-usage-cost.ts";

function row(overrides: Partial<UsageRow> = {}): UsageRow {
  return {
    id: 1,
    model: "openai/gpt-5-nano",
    promptTokens: 1000,
    completionTokens: 500,
    costUsd: "0.000000",
    createdAt: new Date("2026-05-01T00:00:00Z"),
    ...overrides,
  };
}

function entry(
  pricing: { prompt?: string; completion?: string },
  fetchedAtIso: string | null,
): CatalogEntry {
  return {
    payload: { pricing },
    fetchedAt: fetchedAtIso ? new Date(fetchedAtIso) : null,
  };
}

test("compareCostRow: match when recomputed equals recorded within EPSILON", () => {
  const v = compareCostRow(
    row({ costUsd: "0.000200" }),
    entry({ prompt: "0.0000001", completion: "0.0000002" }, "2026-05-01T00:00:00Z"),
  );
  assert.equal(v.verdict, "match");
});

test("compareCostRow: mismatch-drift when catalog newer than row", () => {
  // recomputed 7.5e-4, recorded 1e-4
  const v = compareCostRow(
    row({ costUsd: "0.000100" }),
    entry({ prompt: "0.0000005", completion: "0.0000005" }, "2026-05-15T00:00:00Z"),
  );
  assert.equal(v.verdict, "mismatch-drift");
  assert.equal(v.mismatch?.likelyDrift, true);
});

test("compareCostRow: mismatch-formula when catalog older or same age as row", () => {
  const v = compareCostRow(
    row({ costUsd: "0.000100" }),
    entry({ prompt: "0.0000005", completion: "0.0000005" }, "2026-04-15T00:00:00Z"),
  );
  assert.equal(v.verdict, "mismatch-formula");
  assert.equal(v.mismatch?.likelyDrift, false);
});

test("compareCostRow: mismatch with no catalog fetchedAt → treated as drift", () => {
  const v = compareCostRow(
    row({ costUsd: "0.000100" }),
    entry({ prompt: "0.0000005", completion: "0.0000005" }, null),
  );
  assert.equal(v.verdict, "mismatch-drift");
});

test("compareCostRow: mismatch with no row createdAt → treated as drift", () => {
  const v = compareCostRow(
    row({ costUsd: "0.000100", createdAt: null }),
    entry({ prompt: "0.0000005", completion: "0.0000005" }, "2026-04-15T00:00:00Z"),
  );
  assert.equal(v.verdict, "mismatch-drift");
});

test("compareCostRow: catalog-missing when entry is null", () => {
  const v = compareCostRow(row(), null);
  assert.equal(v.verdict, "catalog-missing");
});

test("compareCostRow: missing prompt price → only completion charged", () => {
  const v = compareCostRow(
    row({ costUsd: "0.000100" }),
    entry({ completion: "0.0000002" }, "2026-05-01T00:00:00Z"),
  );
  assert.equal(v.verdict, "match");
});

test("compareCostRow: non-numeric pricing strings → treated as 0", () => {
  const v = compareCostRow(
    row({ costUsd: "0.000000" }),
    entry({ prompt: "not-a-number", completion: "neither" }, "2026-05-01T00:00:00Z"),
  );
  assert.equal(v.verdict, "match");
});

test("compareCostRow: epsilon boundary stays as match", () => {
  const v = compareCostRow(
    row({ costUsd: (0.0001 - EPSILON_USD).toFixed(6) }),
    entry({ prompt: "0.0000001", completion: "0" }, "2026-05-01T00:00:00Z"),
  );
  assert.equal(v.verdict, "match");
});

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
  type UsageRow,
} from "./audit-openrouter-usage-cost.ts";

function row(overrides: Partial<UsageRow> = {}): UsageRow {
  return {
    id: 1,
    model: "openai/gpt-5-nano",
    promptTokens: 1000,
    completionTokens: 500,
    costUsd: "0.000000",
    ...overrides,
  };
}

test("compareCostRow: match when recomputed equals recorded within EPSILON", () => {
  // 1000 × 1e-7 + 500 × 2e-7 = 2e-4
  const v = compareCostRow(row({ costUsd: "0.000200" }), {
    pricing: { prompt: "0.0000001", completion: "0.0000002" },
  });
  assert.equal(v.verdict, "match");
});

test("compareCostRow: mismatch when delta exceeds EPSILON", () => {
  const v = compareCostRow(row({ costUsd: "0.000100" }), {
    pricing: { prompt: "0.0000005", completion: "0.0000005" }, // 1000×5e-7 + 500×5e-7 = 7.5e-4
  });
  assert.equal(v.verdict, "mismatch");
  assert.equal(v.mismatch?.id, 1);
  assert.equal(v.mismatch?.recorded, 0.0001);
  assert.equal(v.mismatch?.recomputed, 0.00075);
  assert.ok(Math.abs((v.mismatch?.delta ?? 0) - 0.00065) < 1e-10);
});

test("compareCostRow: catalog-missing when payload is null", () => {
  const v = compareCostRow(row(), null);
  assert.equal(v.verdict, "catalog-missing");
});

test("compareCostRow: missing prompt price → only completion charged", () => {
  // 500 × 2e-7 = 1e-4
  const v = compareCostRow(row({ costUsd: "0.000100" }), {
    pricing: { completion: "0.0000002" },
  });
  assert.equal(v.verdict, "match");
});

test("compareCostRow: non-numeric pricing strings → treated as 0", () => {
  const v = compareCostRow(row({ costUsd: "0.000000" }), {
    pricing: { prompt: "not-a-number", completion: "neither" },
  });
  assert.equal(v.verdict, "match"); // recomputed = 0, recorded = 0
});

test("compareCostRow: epsilon boundary stays as match", () => {
  // recomputed = 1e-4 (from 1000 × 1e-7), recorded = 1e-4 - EPSILON
  const v = compareCostRow(
    row({ costUsd: (0.0001 - EPSILON_USD).toFixed(6) }),
    { pricing: { prompt: "0.0000001", completion: "0" } },
  );
  assert.equal(v.verdict, "match");
});

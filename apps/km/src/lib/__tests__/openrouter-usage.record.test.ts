// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the db so we never touch Postgres in this unit test.
// Two paths in the SUT: SELECT (catalog lookup) + INSERT (usage row).
const selectChain = {
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  limit: vi.fn(),
};
const insertChain = {
  values: vi.fn().mockResolvedValue(undefined),
};
vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => selectChain),
    insert: vi.fn(() => insertChain),
  },
}));

import { db } from "@/lib/db";
import { recordUsage } from "../openrouter-usage";

beforeEach(() => {
  selectChain.limit.mockReset();
  selectChain.from.mockClear();
  selectChain.where.mockClear();
  insertChain.values.mockReset().mockResolvedValue(undefined);
  vi.mocked(db.insert).mockClear();
  vi.mocked(db.select).mockClear();
});

describe("recordUsage", () => {
  it("computes cost from catalog pricing and inserts a row (signed-in user)", async () => {
    // Catalog: prompt $0.0000005/tok, completion $0.0000015/tok.
    selectChain.limit.mockResolvedValue([
      {
        payload: {
          id: "openai/gpt-4o",
          pricing: { prompt: "0.0000005", completion: "0.0000015" },
        },
      },
    ]);

    await recordUsage({
      userId: "user_abc",
      guestSessionId: null,
      model: "openai/gpt-4o",
      promptTokens: 1000,
      completionTokens: 1000,
      source: "ai-fill",
    });

    expect(insertChain.values).toHaveBeenCalledTimes(1);
    const row = insertChain.values.mock.calls[0][0];
    // 1000 * 0.0000005 = 0.0005; 1000 * 0.0000015 = 0.0015; sum = 0.002.
    expect(row.userId).toBe("user_abc");
    expect(row.guestSessionId).toBeNull();
    expect(row.model).toBe("openai/gpt-4o");
    expect(row.promptTokens).toBe(1000);
    expect(row.completionTokens).toBe(1000);
    expect(row.source).toBe("ai-fill");
    // numeric is stored as a string in the cost_usd column.
    expect(Number(row.costUsd)).toBeCloseTo(0.002, 6);
  });

  it("stores cost=0 when the model is missing from the catalog (defensive)", async () => {
    selectChain.limit.mockResolvedValue([]);

    await recordUsage({
      userId: null,
      guestSessionId: "guest_anon_1",
      model: "unknown/model",
      promptTokens: 500,
      completionTokens: 200,
      source: "km-agent",
    });

    expect(insertChain.values).toHaveBeenCalledTimes(1);
    const row = insertChain.values.mock.calls[0][0];
    expect(row.userId).toBeNull();
    expect(row.guestSessionId).toBe("guest_anon_1");
    expect(Number(row.costUsd)).toBe(0);
  });

  it("handles a row whose payload.pricing fields are absent", async () => {
    selectChain.limit.mockResolvedValue([
      { payload: { id: "weird/model" /* no pricing block */ } },
    ]);

    await recordUsage({
      userId: "user_xyz",
      guestSessionId: null,
      model: "weird/model",
      promptTokens: 10,
      completionTokens: 20,
      source: "ai-fill",
    });

    const row = insertChain.values.mock.calls[0][0];
    expect(Number(row.costUsd)).toBe(0);
  });
});

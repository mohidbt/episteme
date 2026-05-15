// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { openrouterUsage, user } from "@episteme/db/schema";
import {
  getRecentSpendUsd,
  OR_USER_SOFT_LIMIT_USD,
  OR_GUEST_SOFT_LIMIT_USD,
} from "../openrouter-usage";

async function makeUser(): Promise<string> {
  const id = `oru_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
  await db.insert(user).values({
    id,
    name: "oru",
    email: `${id}@t.local`,
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return id;
}

const userIds: string[] = [];

let uA: string;
let uB: string;

beforeAll(async () => {
  uA = await makeUser();
  uB = await makeUser();
  userIds.push(uA, uB);

  // uA: 3 rows across 2 models → 0.10 + 0.20 + 0.05 = 0.35 USD; gpt-4o 0.30, claude 0.05
  await db.insert(openrouterUsage).values({
    userId: uA,
    guestSessionId: null,
    model: "openai/gpt-4o",
    promptTokens: 100,
    completionTokens: 100,
    costUsd: "0.100000",
    source: "ai-fill",
  });
  await db.insert(openrouterUsage).values({
    userId: uA,
    guestSessionId: null,
    model: "openai/gpt-4o",
    promptTokens: 200,
    completionTokens: 200,
    costUsd: "0.200000",
    source: "km-agent",
  });
  await db.insert(openrouterUsage).values({
    userId: uA,
    guestSessionId: null,
    model: "anthropic/claude-4.7",
    promptTokens: 50,
    completionTokens: 50,
    costUsd: "0.050000",
    source: "ai-fill",
  });

  // uB: one row with a different total to prove scoping works.
  await db.insert(openrouterUsage).values({
    userId: uB,
    guestSessionId: null,
    model: "openai/gpt-4o",
    promptTokens: 10,
    completionTokens: 10,
    costUsd: "0.999999",
    source: "ai-fill",
  });
});

afterAll(async () => {
  if (userIds.length) await db.delete(user).where(inArray(user.id, userIds));
});

describe("getRecentSpendUsd", () => {
  it("sums total USD and groups by model for a signed-in user", async () => {
    const out = await getRecentSpendUsd(uA, null);
    expect(out.totalUsd).toBeCloseTo(0.35, 6);
    const byModel = Object.fromEntries(out.byModel.map((b) => [b.model, b.usd]));
    expect(byModel["openai/gpt-4o"]).toBeCloseTo(0.3, 6);
    expect(byModel["anthropic/claude-4.7"]).toBeCloseTo(0.05, 6);
  });

  it("scopes by identity — uB's spend isolated from uA", async () => {
    const out = await getRecentSpendUsd(uB, null);
    expect(out.totalUsd).toBeCloseTo(0.999999, 6);
  });

  it("returns zero total for an identity with no rows", async () => {
    const out = await getRecentSpendUsd("does_not_exist", null);
    expect(out.totalUsd).toBe(0);
    expect(out.byModel).toEqual([]);
  });

  it("exposes the soft-limit constants", () => {
    expect(OR_USER_SOFT_LIMIT_USD).toBe(5);
    expect(OR_GUEST_SOFT_LIMIT_USD).toBe(1);
  });
});

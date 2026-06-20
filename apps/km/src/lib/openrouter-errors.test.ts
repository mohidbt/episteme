// #69 — friendly OpenRouter auth-error mapping.
import { describe, it, expect } from "vitest";
import {
  OPENROUTER_KEY_MISSING,
  OPENROUTER_KEY_INVALID,
  mapOpenRouterStatus,
  isOpenRouterKeyError,
  classifyOrError,
} from "./openrouter-errors";

describe("openrouter-errors", () => {
  it("maps 401 to OPENROUTER_KEY_INVALID", () => {
    expect(mapOpenRouterStatus(401)).toBe(OPENROUTER_KEY_INVALID);
  });

  it("maps 403 to OPENROUTER_KEY_INVALID", () => {
    expect(mapOpenRouterStatus(403)).toBe(OPENROUTER_KEY_INVALID);
  });

  it("returns null for non-auth statuses", () => {
    expect(mapOpenRouterStatus(500)).toBeNull();
    expect(mapOpenRouterStatus(200)).toBeNull();
  });

  it("isOpenRouterKeyError recognizes both codes", () => {
    expect(isOpenRouterKeyError(OPENROUTER_KEY_MISSING)).toBe(true);
    expect(isOpenRouterKeyError(OPENROUTER_KEY_INVALID)).toBe(true);
    expect(isOpenRouterKeyError("something_else")).toBe(false);
    expect(isOpenRouterKeyError(undefined)).toBe(false);
  });
});

// GSD-136 — OR returns 401 with a quota-hinted body when a provisioning-API
// key exceeds its `limit`. The legacy "402 = trial_exhausted" check missed
// this case. classifyOrError takes (status, bodyText) and disambiguates
// trial-exhausted (limit drained) from key-invalid (real auth failure).
describe("classifyOrError — trial-exhausted disambiguation (GSD-136)", () => {
  it("402 with any body → trial_exhausted (legacy contract preserved)", () => {
    expect(classifyOrError(402, "")).toBe("trial_exhausted");
    expect(classifyOrError(402, "{}")).toBe("trial_exhausted");
  });

  it("401 with credit-limit body → trial_exhausted (the bug GSD-136 fixes)", () => {
    const orBody = JSON.stringify({
      error: {
        code: 401,
        message:
          "This request requires more credits, or fewer max_tokens. You requested up to 1000 tokens, but can only afford 0. To increase, visit https://openrouter.ai/credits",
      },
    });
    expect(classifyOrError(401, orBody)).toBe("trial_exhausted");
  });

  it("401 with quota-exceeded body → trial_exhausted", () => {
    expect(
      classifyOrError(401, '{"error":{"message":"quota exceeded"}}'),
    ).toBe("trial_exhausted");
  });

  it("401 with insufficient-credits body → trial_exhausted", () => {
    expect(
      classifyOrError(
        401,
        '{"error":{"message":"Account has insufficient credits"}}',
      ),
    ).toBe("trial_exhausted");
  });

  it("401 with key-revoked body → key_invalid (do NOT misclassify real auth fail)", () => {
    expect(
      classifyOrError(401, '{"error":{"message":"No auth credentials found"}}'),
    ).toBe("key_invalid");
    expect(
      classifyOrError(401, '{"error":{"message":"Invalid API key"}}'),
    ).toBe("key_invalid");
    expect(classifyOrError(401, "")).toBe("key_invalid");
  });

  it("403 with quota body → trial_exhausted (legacy 403-quota path preserved)", () => {
    expect(
      classifyOrError(403, '{"error":{"message":"insufficient_quota"}}'),
    ).toBe("trial_exhausted");
  });

  it("403 without quota hint → key_invalid", () => {
    expect(classifyOrError(403, '{"error":{"message":"Forbidden"}}')).toBe(
      "key_invalid",
    );
  });

  it("non-auth status → other (caller bubbles to generic upstream-error)", () => {
    expect(classifyOrError(500, "")).toBe("other");
    expect(classifyOrError(429, "")).toBe("other");
    expect(classifyOrError(200, "")).toBe("other");
  });
});

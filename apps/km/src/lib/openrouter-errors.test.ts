// #69 — friendly OpenRouter auth-error mapping.
import { describe, it, expect } from "vitest";
import {
  OPENROUTER_KEY_MISSING,
  OPENROUTER_KEY_INVALID,
  mapOpenRouterStatus,
  isOpenRouterKeyError,
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

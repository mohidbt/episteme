import { describe, expect, it } from "vitest";
import { isUniqueViolation } from "./pg-errors";

describe("isUniqueViolation", () => {
  it("detects direct postgres unique-violation code", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
  });

  it("detects drizzle-wrapped unique-violation via cause", () => {
    const err = new Error("duplicate key value violates unique constraint");
    (err as unknown as { cause: unknown }).cause = { code: "23505" };
    expect(isUniqueViolation(err)).toBe(true);
  });

  it("returns false for non-unique pg errors", () => {
    expect(isUniqueViolation({ code: "23503" })).toBe(false);
  });

  it("returns false for plain Error without code", () => {
    expect(isUniqueViolation(new Error("boom"))).toBe(false);
  });

  it("returns false for non-objects", () => {
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
    expect(isUniqueViolation("string")).toBe(false);
  });
});

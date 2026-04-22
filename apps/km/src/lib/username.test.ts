import { describe, expect, it } from "vitest";
import { isValidUsername, isReservedUsername, RESERVED } from "./username";

describe("isValidUsername", () => {
  it("accepts lowercase+digits+hyphens, 3–30 chars", () => {
    expect(isValidUsername("mohid")).toBe(true);
    expect(isValidUsername("foo-bar-123")).toBe(true);
    expect(isValidUsername("abc")).toBe(true);
    expect(isValidUsername("a".repeat(30))).toBe(true);
  });
  it("rejects uppercase, underscores, too short, too long", () => {
    expect(isValidUsername("Mohid")).toBe(false);
    expect(isValidUsername("foo_bar")).toBe(false);
    expect(isValidUsername("ab")).toBe(false);
    expect(isValidUsername("a".repeat(31))).toBe(false);
    expect(isValidUsername("")).toBe(false);
    expect(isValidUsername("-foo")).toBe(true);
  });
  it("rejects reserved names", () => {
    expect(isValidUsername("app")).toBe(false);
    expect(isValidUsername("www")).toBe(false);
    expect(isValidUsername("api")).toBe(false);
  });
});

describe("isReservedUsername", () => {
  it("covers the full RESERVED set", () => {
    for (const name of RESERVED) {
      expect(isReservedUsername(name)).toBe(true);
    }
    expect(isReservedUsername("mohid")).toBe(false);
  });
  it("is case-insensitive", () => {
    expect(isReservedUsername("App")).toBe(true);
    expect(isReservedUsername("API")).toBe(true);
  });
});

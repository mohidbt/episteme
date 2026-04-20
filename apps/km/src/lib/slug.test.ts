import { describe, it, expect } from "vitest";
import { toSlug, toPublicSlug } from "./slug";

describe("toSlug", () => {
  it("lowercases ASCII with spaces", () => {
    expect(toSlug("Hello World")).toBe("hello-world");
  });

  it("strips diacritics", () => {
    expect(toSlug("naïve café")).toBe("naive-cafe");
  });

  it("replaces special chars with a single hyphen", () => {
    expect(toSlug("Quantum !@#$ Mechanics")).toBe("quantum-mechanics");
  });

  it("collapses multiple hyphens", () => {
    expect(toSlug("a--b---c")).toBe("a-b-c");
  });

  it("returns 'untitled' when input strips to empty", () => {
    expect(toSlug("!@#$")).toBe("untitled");
  });

  it("returns 'untitled' for empty string", () => {
    expect(toSlug("")).toBe("untitled");
  });

  it("truncates long titles to <= 80 chars", () => {
    const longInput = "a".repeat(200);
    const result = toSlug(longInput);
    expect(result.length).toBeLessThanOrEqual(80);
  });

  it("trims leading and trailing hyphens", () => {
    expect(toSlug("---hello---")).toBe("hello");
  });
});

describe("toPublicSlug", () => {
  it("appends a 6-char lowercase alphanumeric suffix", () => {
    const result = toPublicSlug("Hello World");
    expect(result).toMatch(/^hello-world-[a-z0-9]{6}$/);
  });

  it("differs on repeated calls", () => {
    const a = toPublicSlug("Hello World");
    const b = toPublicSlug("Hello World");
    expect(a).not.toBe(b);
  });
});

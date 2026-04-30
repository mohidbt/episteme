import { describe, it, expect } from "vitest";
import { deriveThreadTitle } from "./thread-title";

describe("deriveThreadTitle (Task #41)", () => {
  it("returns null for empty / whitespace-only input", () => {
    expect(deriveThreadTitle("")).toBeNull();
    expect(deriveThreadTitle("   \n\t ")).toBeNull();
  });

  it("returns the message as-is when shorter than the cap", () => {
    expect(deriveThreadTitle("Summarise this paper")).toBe("Summarise this paper");
  });

  it("collapses interior whitespace runs", () => {
    expect(deriveThreadTitle("hello   world\n\nmore  text")).toBe(
      "hello world more text",
    );
  });

  it("truncates long input on a word boundary and appends an ellipsis", () => {
    const long =
      "Please give me a detailed comparison of attention-based versus convolutional architectures across recent benchmarks";
    const out = deriveThreadTitle(long, 50)!;
    expect(out.length).toBeLessThanOrEqual(51); // 50 chars + ellipsis
    expect(out.endsWith("…")).toBe(true);
    // Must not slice a word in half: char before the ellipsis is non-space and
    // the chunk before the ellipsis matches a prefix of the original (with
    // collapsed whitespace).
    const prefix = out.slice(0, -1);
    expect(long.startsWith(prefix)).toBe(true);
  });

  it("hard-cuts when there is no whitespace in the budget", () => {
    const out = deriveThreadTitle("a".repeat(100), 50);
    expect(out).toBe(`${"a".repeat(50)}…`);
  });
});

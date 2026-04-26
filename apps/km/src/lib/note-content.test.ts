import { describe, expect, it } from "vitest";
import { prepareNoteContent } from "./note-content";

describe("prepareNoteContent escape-density gate", () => {
  it("passes through clean markdown unchanged", () => {
    const clean = "# Hello\n\nThis is **bold** and _italic_.\n";
    expect(prepareNoteContent(clean)).toBe(clean);
  });

  it("applies unescaping when escape density exceeds 0.5%", () => {
    // Craft a string where >0.5% of characters are escape sequences.
    // "1\\. \\*\\*foo\\*\\*" — 4 escapes in ~18 chars = ~22% density
    const legacy = "1\\. \\*\\*foo\\*\\*";
    const result = prepareNoteContent(legacy);
    expect(result).toBe("1. **foo**");
  });

  it("does NOT apply unescaping when escape density is at or below 0.5%", () => {
    // One backslash escape in a long piece of text: density < 0.5%
    const longText = "A".repeat(500) + "\\*" + "B".repeat(500);
    // density = 1 escape / 1002 chars ≈ 0.0999%
    expect(prepareNoteContent(longText)).toBe(longText);
  });

  it("handles empty string without throwing", () => {
    expect(prepareNoteContent("")).toBe("");
  });

  it("boundary: exactly 0.5% density stays unchanged (not strictly greater)", () => {
    // We need exactly 0.005 density. With 200 chars, 1 escape sequence = 0.5%.
    // density = 1/200 = 0.005 — NOT > 0.005 so should pass through.
    const text = "A".repeat(198) + "\\*";
    // length = 200, 1 escape, density = 0.005 — NOT > 0.005
    expect(prepareNoteContent(text)).toBe(text);
  });

  it("boundary: density just above 0.5% triggers unescaping", () => {
    // 2 escapes in 199 chars = 2/199 ≈ 1.005% > 0.5%
    const text = "A".repeat(195) + "\\*" + "B" + "\\*";
    // length = 199, 2 escapes, density ≈ 1.005% > 0.5%
    const result = prepareNoteContent(text);
    expect(result).toBe("A".repeat(195) + "*" + "B" + "*");
  });
});

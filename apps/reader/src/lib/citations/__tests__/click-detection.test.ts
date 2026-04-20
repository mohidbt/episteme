import { describe, it, expect } from "vitest";
import { findCitationMarkerAtOffset } from "../click-detection";

describe("findCitationMarkerAtOffset", () => {
  it("returns markerIndex when offset is inside [n]", () => {
    expect(findCitationMarkerAtOffset("see [3] for details", 5)).toBe(3);
  });

  it("returns null when offset is not inside a marker", () => {
    expect(findCitationMarkerAtOffset("see [3] for details", 0)).toBeNull();
  });

  it("returns null for offset in regular text after marker", () => {
    expect(findCitationMarkerAtOffset("see [3] for details", 8)).toBeNull();
  });

  it("detects click on opening bracket", () => {
    // "[3]" starts at index 4
    expect(findCitationMarkerAtOffset("see [3] for", 4)).toBe(3);
  });

  it("detects click on the digit", () => {
    expect(findCitationMarkerAtOffset("see [3] for", 5)).toBe(3);
  });

  it("detects click on closing bracket", () => {
    expect(findCitationMarkerAtOffset("see [3] for", 6)).toBe(3);
  });

  it("handles multi-digit marker index [12]", () => {
    // "[12]" is at index 4..7
    expect(findCitationMarkerAtOffset("foo [12] bar", 5)).toBe(12);
    expect(findCitationMarkerAtOffset("foo [12] bar", 6)).toBe(12);
  });

  it("handles marker at start of string", () => {
    expect(findCitationMarkerAtOffset("[1] some text", 0)).toBe(1);
    expect(findCitationMarkerAtOffset("[1] some text", 2)).toBe(1);
  });

  it("handles marker at end of string", () => {
    const text = "trailing [5]";
    const start = text.indexOf("[5]");
    expect(findCitationMarkerAtOffset(text, start)).toBe(5);
    expect(findCitationMarkerAtOffset(text, start + 2)).toBe(5);
  });

  it("handles multiple markers and returns correct one", () => {
    const text = "first [1] and [2] done";
    // [1] at index 6..8, [2] at index 14..16
    expect(findCitationMarkerAtOffset(text, 6)).toBe(1);
    expect(findCitationMarkerAtOffset(text, 14)).toBe(2);
    expect(findCitationMarkerAtOffset(text, 10)).toBeNull(); // "and"
  });

  it("returns null for empty string", () => {
    expect(findCitationMarkerAtOffset("", 0)).toBeNull();
  });

  it("returns null for offset outside string bounds", () => {
    expect(findCitationMarkerAtOffset("foo [1] bar", 100)).toBeNull();
  });

  it("ignores [0] (out of range)", () => {
    expect(findCitationMarkerAtOffset("text [0] here", 5)).toBeNull();
  });

  it("ignores [1000] (out of range)", () => {
    expect(findCitationMarkerAtOffset("text [1000] here", 5)).toBeNull();
  });

  it("handles three-digit marker [999]", () => {
    const text = "see [999] ref";
    expect(findCitationMarkerAtOffset(text, 4)).toBe(999);
    expect(findCitationMarkerAtOffset(text, 8)).toBe(999);
  });
});

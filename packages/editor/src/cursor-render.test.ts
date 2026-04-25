// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { userColor, buildCursorElement } from "./extensions";

describe("userColor", () => {
  it("returns a valid 7-char hex color string", () => {
    expect(userColor("alice")).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("returns consistent color for same name", () => {
    expect(userColor("bob")).toBe(userColor("bob"));
  });

  it("returns different colors for different names", () => {
    expect(userColor("alice")).not.toBe(userColor("bob"));
  });

  it("does not return grey (#666666 or similar) for typical names", () => {
    // #666 was the hardcoded problematic color — make sure our hash avoids it
    // for common names (not a strict invariant, just a smoke check).
    const problematic = "#666666";
    expect(userColor("alice")).not.toBe(problematic);
    expect(userColor("bob")).not.toBe(problematic);
  });
});

describe("buildCursorElement", () => {
  it("returns an HTMLElement", () => {
    const el = buildCursorElement({ name: "alice", color: "#3b82f6" });
    expect(el).toBeInstanceOf(HTMLElement);
  });

  it("applies a border-left style on the caret element", () => {
    const el = buildCursorElement({ name: "alice", color: "#3b82f6" });
    // JSDOM normalizes hex → rgb; just verify border-left is set
    const css = el.getAttribute("style") ?? el.style.cssText;
    expect(css).toContain("border-left");
  });

  it("renders a child label with user name", () => {
    const el = buildCursorElement({ name: "Alice Smith", color: "#3b82f6" });
    const label = el.querySelector("span");
    expect(label).not.toBeNull();
    expect(label!.textContent).toBe("Alice Smith");
  });

  it("label has background-color set in its style", () => {
    const el = buildCursorElement({ name: "alice", color: "#ff5733" });
    const label = el.querySelector("span");
    // JSDOM normalizes hex → rgb(255, 87, 51); verify background-color is present
    const css = label!.getAttribute("style") ?? label!.style.cssText;
    expect(css).toContain("background-color");
    // Verify the rgb equivalent of #ff5733
    expect(label!.style.backgroundColor).toBe("rgb(255, 87, 51)");
  });

  it("falls back gracefully when color/name are missing", () => {
    expect(() => buildCursorElement({})).not.toThrow();
  });
});

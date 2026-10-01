/**
 * G-R3-02 (#68): Slash command menu must flip above the caret when there
 * isn't enough room below — otherwise the menu renders off-screen at the
 * bottom of the editor and the user can't see it.
 */
import { describe, expect, it } from "vitest";
import { computeSlashMenuPlacement } from "./popover-placement";

describe("computeSlashMenuPlacement", () => {
  const VIEWPORT_H = 800;
  const MENU_H = 320;

  it("places menu BELOW caret when there is room below", () => {
    const result = computeSlashMenuPlacement({
      caret: { top: 100, bottom: 120, left: 50 },
      menuHeight: MENU_H,
      viewportHeight: VIEWPORT_H,
      scrollY: 0,
      scrollX: 0,
    });
    expect(result.placement).toBe("bottom");
    expect(result.top).toBe(120 + 4);
    expect(result.left).toBe(50);
  });

  it("flips menu ABOVE caret when there is no room below (viewport bottom)", () => {
    // Caret near the bottom of the viewport: only 30px below, 770px above.
    const result = computeSlashMenuPlacement({
      caret: { top: 750, bottom: 770, left: 50 },
      menuHeight: MENU_H,
      viewportHeight: VIEWPORT_H,
      scrollY: 0,
      scrollX: 0,
    });
    expect(result.placement).toBe("top");
    // Menu top is caret.top - menuHeight - gap
    expect(result.top).toBe(750 - MENU_H - 4);
    // Top must be ABOVE caret top
    expect(result.top).toBeLessThan(750);
  });

  it("respects scroll offset when flipping up", () => {
    const result = computeSlashMenuPlacement({
      caret: { top: 750, bottom: 770, left: 50 },
      menuHeight: MENU_H,
      viewportHeight: VIEWPORT_H,
      scrollY: 200,
      scrollX: 10,
    });
    expect(result.placement).toBe("top");
    expect(result.top).toBe(750 + 200 - MENU_H - 4);
    expect(result.left).toBe(50 + 10);
  });

  it("stays below when room below is exactly equal to menu+gap", () => {
    const result = computeSlashMenuPlacement({
      caret: { top: 100, bottom: VIEWPORT_H - MENU_H - 4, left: 0 },
      menuHeight: MENU_H,
      viewportHeight: VIEWPORT_H,
      scrollY: 0,
      scrollX: 0,
    });
    expect(result.placement).toBe("bottom");
  });

  describe("horizontal clamp", () => {
    const base = {
      menuHeight: MENU_H,
      viewportHeight: VIEWPORT_H,
      scrollY: 0,
      scrollX: 0,
      viewportWidth: 1280,
      menuWidth: 280,
    };

    it("pulls the menu left when it would cross the right edge", () => {
      const result = computeSlashMenuPlacement({
        ...base,
        caret: { top: 100, bottom: 120, left: 1200 },
      });
      expect(result.left).toBe(1280 - 280 - 8);
    });

    it("pushes the menu right when the caret sits left of the margin", () => {
      const result = computeSlashMenuPlacement({
        ...base,
        caret: { top: 100, bottom: 120, left: 2 },
      });
      expect(result.left).toBe(8);
    });

    it("leaves left at the caret when there is room", () => {
      const result = computeSlashMenuPlacement({
        ...base,
        caret: { top: 100, bottom: 120, left: 400 },
      });
      expect(result.left).toBe(400);
    });

    it("adds the scroll offset after clamping", () => {
      const result = computeSlashMenuPlacement({
        ...base,
        scrollX: 30,
        caret: { top: 100, bottom: 120, left: 1200 },
      });
      expect(result.left).toBe(1280 - 280 - 8 + 30);
    });
  });

  it("keeps a menu that fits on neither side inside the viewport", () => {
    const result = computeSlashMenuPlacement({
      caret: { top: 190, bottom: 210, left: 50 },
      menuHeight: 380,
      viewportHeight: 400,
      scrollY: 0,
      scrollX: 0,
    });
    expect(result.top).toBe(400 - 380 - 8);
  });
});

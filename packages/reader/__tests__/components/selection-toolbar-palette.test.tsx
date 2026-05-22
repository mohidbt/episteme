import { afterEach, describe, it, expect } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { SelectionToolbar } from "../../src/components/SelectionToolbar";

afterEach(() => cleanup());

// Source of truth: apps/km/src/app/api/user-highlights/route.ts:24
// const VALID_COLORS = ["yellow", "green", "blue", "pink", "orange", "amber"]
// Note: "yellow" is reserved by the reader for comment overlays, so it is
// allowed in the backend enum but intentionally excluded from the palette.
const VALID_COLORS = new Set(["yellow", "green", "blue", "pink", "orange", "amber"]);

const rect = { top: 100, left: 100, width: 50, height: 20 };

describe("SelectionToolbar palette ↔ backend enum", () => {
  it("does not expose 'purple' (rejected by backend enum)", () => {
    render(
      <SelectionToolbar
        rect={rect}
        onHighlight={() => {}}
        onDismiss={() => {}}
      />
    );
    expect(screen.queryByRole("button", { name: /highlight purple/i })).toBeNull();
  });

  it("every palette swatch is a backend-accepted color", () => {
    render(
      <SelectionToolbar
        rect={rect}
        onHighlight={() => {}}
        onDismiss={() => {}}
      />
    );
    const swatches = screen
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-label") ?? "")
      .filter((l) => l.toLowerCase().startsWith("highlight "))
      .map((l) => l.slice("highlight ".length).toLowerCase());

    expect(swatches.length).toBeGreaterThan(0);
    for (const name of swatches) {
      expect(VALID_COLORS, `palette color "${name}" not in backend VALID_COLORS`).toContain(name);
    }
  });
});

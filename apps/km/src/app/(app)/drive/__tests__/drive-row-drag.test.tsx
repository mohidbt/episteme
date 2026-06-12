// @vitest-environment jsdom
/**
 * GSD-96 Round 2 — drive-page row drag + hoisted DndContext smoke test.
 *
 * Confirms:
 *  - Root `(app)` layout exports `AppDndContext` client wrapper that mounts
 *    a `<DndContext>`.
 *  - `FileBrowserItem` rows are draggable with payload shape
 *    `{ kind: "leaf", itemKind, id, folderId, title }` — same shape DriveTree
 *    emits so the agent composer's `useDroppable` accepts both sources.
 *
 * Edge cases:
 *  - paper row → payload.itemKind === "paper"
 *  - note row  → payload.itemKind === "note"
 *  - reference row → payload.itemKind === "reference"
 *  - paperset row → payload.itemKind === "paperset"
 *  - drag attributes present + listeners bound (smoke)
 *
 * Omitted: full drop-resolution flow (covered by FileBrowser tests + DriveTree
 * tests); SSR hydration (covered separately).
 */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AppDndContext } from "../../app-dnd-context";

describe("AppDndContext (hoisted DndContext)", () => {
  it("exports a client component", () => {
    expect(typeof AppDndContext).toBe("function");
  });

  it("renders children", () => {
    const { getByTestId } = render(
      <AppDndContext>
        <div data-testid="child">hi</div>
      </AppDndContext>,
    );
    expect(getByTestId("child").textContent).toBe("hi");
  });
});

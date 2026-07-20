// @vitest-environment jsdom
//
// GSD-224 (a) — opening the hyperlink popover must dismiss the formatting
// bubble toolbar. The toolbar visibility is driven by the BubbleMenu's
// `shouldShow` prop; clicking the link button (which opens the popover overlay)
// must flip `shouldShow` to return false, mirroring the existing
// `inPortalRephrase` early-return precedent.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

type ShouldShow = (props: { editor: unknown; state: { selection: { from: number; to: number } } }) => boolean;

// Capture the latest shouldShow closure passed to BubbleMenu on each render.
let capturedShouldShow: ShouldShow | null = null;

vi.mock("@episteme/editor", async () => {
  const React = await import("react");
  const BubbleMenuMock = ({
    children,
    shouldShow,
  }: {
    children: React.ReactNode;
    shouldShow?: ShouldShow;
  }) => {
    if (shouldShow) capturedShouldShow = shouldShow;
    return React.createElement("div", null, children);
  };
  return { BubbleMenu: BubbleMenuMock };
});

vi.mock("@/app/(app)/n/[slug]/run-slash-ai", () => ({
  runSlashAi: vi.fn(),
}));

import { AiBubbleMenu } from "./AiBubbleMenu";

function makeEditor() {
  const selection = { from: 5, to: 12, $from: { parent: { textContent: "hello world" } } };
  const editor = {
    state: {
      selection,
      doc: {
        textBetween: () => "selected",
        resolve: () => ({ start: () => 0 }),
      },
    },
    view: {
      dom: document.createElement("div"),
      coordsAtPos: () => ({ top: 0, bottom: 20, left: 0, right: 0 }),
    },
    chain: () => editor,
    focus: () => editor,
    deleteRange: () => editor,
    insertContent: () => editor,
    setTextSelection: () => editor,
    run: () => true,
    isActive: () => false,
    on: () => {},
    off: () => {},
    commands: { focus: () => {} },
  };
  return editor as unknown as Parameters<typeof AiBubbleMenu>[0]["editor"];
}

const selState = { editor: {}, state: { selection: { from: 5, to: 12 } } };

describe("GSD-224 (a): opening the link popover dismisses the bubble toolbar", () => {
  afterEach(() => {
    cleanup();
    capturedShouldShow = null;
  });

  it("shouldShow returns true for a non-empty selection before the popover opens", () => {
    render(<AiBubbleMenu editor={makeEditor()} />);
    expect(capturedShouldShow).not.toBeNull();
    expect(capturedShouldShow!(selState)).toBe(true);
  });

  it("shouldShow returns false once the link button opens the popover", () => {
    render(<AiBubbleMenu editor={makeEditor()} />);
    fireEvent.click(screen.getByLabelText(/insert link/i));
    expect(capturedShouldShow!(selState)).toBe(false);
  });
});

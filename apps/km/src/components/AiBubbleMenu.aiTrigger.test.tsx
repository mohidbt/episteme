// @vitest-environment jsdom
//
// GSD-134 iteration 3 — the slash "AI" trigger increments `aiTriggerCount`,
// which opens the rephrase panel. The structural crash (insertBefore against
// the tippy-relocated <BubbleMenu> div) is fixed by body-portaling the panel
// (see AiBubbleMenu.portalStructure.test.tsx), so the mount effect no longer
// needs to defer past a RAF — it reads the editor coords and opens the panel
// synchronously. This test locks the synchronous-open contract and that the
// panel still opens under React Strict Mode (setup → cleanup → setup).
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { StrictMode } from "react";

// Stub @episteme/editor BubbleMenu so we render children unconditionally.
vi.mock("@episteme/editor", async () => {
  return {
    BubbleMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  };
});

// Mock the SSE call — these tests never submit.
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

describe("GSD-134: AI trigger opens the rephrase panel", () => {
  afterEach(() => cleanup());

  it("reads editor coords and opens the panel synchronously on trigger", () => {
    const editor = makeEditor();
    const focus = vi.fn();
    const coordsAtPos = vi.fn(() => ({ top: 0, bottom: 20, left: 0, right: 0 }));
    (editor as unknown as { commands: { focus: typeof focus } }).commands.focus = focus;
    (editor as unknown as { view: { coordsAtPos: typeof coordsAtPos } }).view.coordsAtPos =
      coordsAtPos;

    const { rerender } = render(<AiBubbleMenu editor={editor} aiTriggerCount={0} />);
    focus.mockClear();
    coordsAtPos.mockClear();

    act(() => {
      rerender(<AiBubbleMenu editor={editor} aiTriggerCount={1} />);
    });

    expect(coordsAtPos).toHaveBeenCalled();
    expect(focus).toHaveBeenCalled();
    expect(screen.getByPlaceholderText("What should I write?")).toBeTruthy();
  });

  it("still opens the panel under React Strict Mode (setup→cleanup→setup)", () => {
    const editor = makeEditor();

    act(() => {
      render(
        <StrictMode>
          <AiBubbleMenu editor={editor} aiTriggerCount={1} />
        </StrictMode>,
      );
    });

    expect(screen.getByPlaceholderText("What should I write?")).toBeTruthy();
  });
});

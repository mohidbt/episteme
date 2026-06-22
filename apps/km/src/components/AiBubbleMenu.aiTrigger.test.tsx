// @vitest-environment jsdom
//
// GSD-134 iteration 2 — the slash "AI" trigger increments `aiTriggerCount`.
// The mount effect must NOT touch the editor DOM (`coordsAtPos`, focus)
// synchronously during React's commit — ProseMirror's view is still settling
// from the `deleteRange` that preceded the trigger. Deferring those reads to a
// requestAnimationFrame lets the editor DOM stabilize first; doing them
// synchronously is the `insertBefore` crash the microtask defer failed to fix.
//
// These tests stub requestAnimationFrame/cancelAnimationFrame, so they live in
// their own file — away from the `waitFor`-based async tests in
// AiBubbleMenu.test.tsx, which poll on real timers/RAF.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

describe("GSD-134: AI trigger defers editor DOM reads past a RAF", () => {
  // Faithful RAF stub: ids are real, cancel actually removes the frame so a
  // cancelled frame does NOT fire on flush. A no-op cancel stub would hide the
  // Strict-Mode dropped-trigger bug.
  let rafMap: Map<number, FrameRequestCallback>;
  let nextRafId: number;
  let originalRaf: typeof globalThis.requestAnimationFrame;
  let originalCancel: typeof globalThis.cancelAnimationFrame;

  beforeEach(() => {
    rafMap = new Map();
    nextRafId = 1;
    originalRaf = globalThis.requestAnimationFrame;
    originalCancel = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      const id = nextRafId++;
      rafMap.set(id, cb);
      return id;
    }) as typeof globalThis.requestAnimationFrame;
    globalThis.cancelAnimationFrame = ((id: number) => {
      rafMap.delete(id);
    }) as typeof globalThis.cancelAnimationFrame;
  });

  afterEach(() => {
    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCancel;
    cleanup();
  });

  const flushFrames = () => {
    // Flush nested RAFs (double-RAF schedules a frame from inside a frame).
    for (let i = 0; i < 5 && rafMap.size > 0; i++) {
      const batch = [...rafMap.entries()];
      rafMap.clear();
      act(() => {
        batch.forEach(([, cb]) => cb(performance.now()));
      });
    }
  };

  it("does NOT call editor.commands.focus or coordsAtPos synchronously on trigger", () => {
    const editor = makeEditor();
    const focus = vi.fn();
    const coordsAtPos = vi.fn(() => ({ top: 0, bottom: 20, left: 0, right: 0 }));
    (editor as unknown as { commands: { focus: typeof focus } }).commands.focus = focus;
    (editor as unknown as { view: { coordsAtPos: typeof coordsAtPos } }).view.coordsAtPos =
      coordsAtPos;

    const { rerender } = render(<AiBubbleMenu editor={editor} aiTriggerCount={0} />);
    focus.mockClear();
    coordsAtPos.mockClear();

    // Simulate the slash "AI" selection bumping the trigger counter.
    act(() => {
      rerender(<AiBubbleMenu editor={editor} aiTriggerCount={1} />);
    });

    // RED before fix: the effect ran coordsAtPos + focus inline during commit.
    expect(coordsAtPos).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();

    // After RAF ticks the deferred reads run and the portal opens.
    flushFrames();
    expect(coordsAtPos).toHaveBeenCalled();
  });

  it("still opens the portal under React Strict Mode (setup→cleanup→setup)", () => {
    // Strict Mode (dev) double-invokes the effect: setup → cleanup → setup.
    // The cleanup cancels the first frame. If `lastTriggerRef` is advanced
    // BEFORE scheduling, the second setup early-returns and the trigger is
    // dropped — the portal never opens. Advancing the ref inside the frame
    // keeps the re-run able to reschedule.
    const editor = makeEditor();
    const coordsAtPos = vi.fn(() => ({ top: 0, bottom: 20, left: 0, right: 0 }));
    (editor as unknown as { view: { coordsAtPos: typeof coordsAtPos } }).view.coordsAtPos =
      coordsAtPos;

    act(() => {
      render(
        <StrictMode>
          <AiBubbleMenu editor={editor} aiTriggerCount={1} />
        </StrictMode>,
      );
    });

    flushFrames();
    // The surviving (second) frame must still run the portal-open work.
    expect(coordsAtPos).toHaveBeenCalled();
    expect(screen.getByPlaceholderText("What should I write?")).toBeTruthy();
  });
});

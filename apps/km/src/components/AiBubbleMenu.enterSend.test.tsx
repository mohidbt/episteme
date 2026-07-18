// @vitest-environment jsdom
//
// GSD-170 — AI Rephrase "Enter-to-send" regression.
//
// Root cause reproduced here: the rephrase prompt input lives inside the Tiptap
// BubbleMenu tippy popper. Because tippy is `interactive` with the default
// `appendTo`, the popper is appended to `editorElement.parentNode`, which sits
// INSIDE the editor's key-isolation host div (packages/editor Editor.tsx wraps
// EditorContent + children in a host carrying `attachEditorKeyIsolation`).
//
// `attachEditorKeyIsolation` binds a BUBBLE-phase `keydown` listener on that
// host that calls `stopPropagation()` for every non-modifier key except
// Escape/Tab — Enter included. React 19 delegates events at `document`, so the
// stopped keydown never reaches React's root and the input's React `onKeyDown`
// NEVER fires. Click events are untouched, so the Send button still works.
//
// This mock reproduces that exact DOM topology: BubbleMenu children render
// inside a host div that runs the real key-isolation logic. A faithful test of
// the layer that actually receives the event — NOT the passthrough <div> mock
// used by the sibling suite, which cannot catch this bug.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

// Mirrors packages/editor/src/key-isolation.ts (not exported from the package).
function shouldStopEditorKeyPropagation(e: KeyboardEvent): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  if (e.key === "Escape" || e.key === "Tab") return false;
  return true;
}

vi.mock("@episteme/editor", async () => {
  return {
    // Reproduce the editor key-isolation host wrapping the bubble-menu content.
    BubbleMenu: ({ children }: { children: React.ReactNode }) => {
      const hostRef = (host: HTMLDivElement | null) => {
        if (!host || (host as unknown as { _iso?: boolean })._iso) return;
        (host as unknown as { _iso?: boolean })._iso = true;
        host.addEventListener("keydown", (e) => {
          if (e instanceof KeyboardEvent && shouldStopEditorKeyPropagation(e)) {
            e.stopPropagation();
          }
        });
      };
      return <div ref={hostRef}>{children}</div>;
    },
  };
});

const runSlashAiMock = vi.fn();
vi.mock("@/app/(app)/n/[slug]/run-slash-ai", () => ({
  runSlashAi: (args: unknown) => runSlashAiMock(args),
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
    toggleBold: () => editor,
    toggleItalic: () => editor,
    toggleCode: () => editor,
    run: () => true,
    isActive: () => false,
    on: () => {},
    off: () => {},
    commands: { focus: () => {} },
  };
  return editor as unknown as Parameters<typeof AiBubbleMenu>[0]["editor"];
}

beforeEach(() => {
  runSlashAiMock.mockReset();
  runSlashAiMock.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

describe("AiBubbleMenu Enter-to-send (GSD-170)", () => {
  it("pressing Enter in the rephrase prompt submits, even under editor key-isolation", () => {
    const editor = makeEditor();
    render(<AiBubbleMenu editor={editor} />);
    fireEvent.click(screen.getByText("AI Rephrase"));

    const input = screen.getByPlaceholderText("How should AI rewrite this?") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "make it formal" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(runSlashAiMock).toHaveBeenCalledTimes(1);
    const call = runSlashAiMock.mock.calls[0]![0] as { prompt: string; mode: string };
    expect(call.prompt).toBe("make it formal");
    expect(call.mode).toBe("rephrase");
  });

  it("Send button still submits under the same key-isolation host (control)", () => {
    const editor = makeEditor();
    render(<AiBubbleMenu editor={editor} />);
    fireEvent.click(screen.getByText("AI Rephrase"));

    const input = screen.getByPlaceholderText("How should AI rewrite this?");
    fireEvent.change(input, { target: { value: "make it formal" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(runSlashAiMock).toHaveBeenCalledTimes(1);
  });

  it("empty prompt + Enter does not submit (matches Send no-op guard)", () => {
    const editor = makeEditor();
    render(<AiBubbleMenu editor={editor} />);
    fireEvent.click(screen.getByText("AI Rephrase"));

    const input = screen.getByPlaceholderText("How should AI rewrite this?");
    fireEvent.keyDown(input, { key: "Enter" });

    expect(runSlashAiMock).not.toHaveBeenCalled();
  });

  it("Enter still submits after Refine remounts the input", async () => {
    // Refine unmounts the prompt input (mode -> rephrase-done) and remounts it
    // (back to rephrase-prompt). The native keydown listener must re-bind to the
    // new input element, or Enter silently breaks on the second round.
    let onToken: ((c: string) => void) | undefined;
    runSlashAiMock.mockImplementation((args: { onToken: (c: string) => void }) => {
      onToken = args.onToken;
      return Promise.resolve(undefined);
    });
    const editor = makeEditor();
    render(<AiBubbleMenu editor={editor} />);
    fireEvent.click(screen.getByText("AI Rephrase"));

    const input = screen.getByPlaceholderText("How should AI rewrite this?");
    fireEvent.change(input, { target: { value: "first" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(runSlashAiMock).toHaveBeenCalledTimes(1);

    // Stream a token so aiOutput is non-empty, then land on rephrase-done.
    onToken?.("some output");
    const refineBtn = await screen.findByRole("button", { name: /refine/i });
    fireEvent.click(refineBtn);

    // Input is remounted; Enter must submit again.
    const input2 = screen.getByPlaceholderText("Refine the rephrased text…");
    fireEvent.change(input2, { target: { value: "second" } });
    fireEvent.keyDown(input2, { key: "Enter" });
    expect(runSlashAiMock).toHaveBeenCalledTimes(2);
    const call = runSlashAiMock.mock.calls[1]![0] as { prompt: string };
    expect(call.prompt).toBe("second");
  });

  it("Shift+Enter does not submit", () => {
    const editor = makeEditor();
    render(<AiBubbleMenu editor={editor} />);
    fireEvent.click(screen.getByText("AI Rephrase"));

    const input = screen.getByPlaceholderText("How should AI rewrite this?");
    fireEvent.change(input, { target: { value: "line one" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });

    expect(runSlashAiMock).not.toHaveBeenCalled();
  });
});

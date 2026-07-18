// @vitest-environment jsdom
//
// GSD-170 — two note-editor AI Rephrase fixes:
//   1. Pressing Enter in the prompt input sends (same as the Send button).
//      Shift+Enter must NOT send.
//   2. The streamed LLM output renders as markdown (bold/heading/list), not
//      raw markdown source text.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";

vi.mock("@episteme/editor", async () => {
  return {
    BubbleMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  };
});

// Capture the runSlashAi args so we can (a) assert Enter submits and (b) drive
// tokens into onToken to exercise the output renderer.
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
  globalThis.fetch = vi.fn(async () => new Response("not found", { status: 404 })) as unknown as typeof fetch;
});

afterEach(() => cleanup());

describe("GSD-170: Enter-to-send in the rephrase prompt", () => {
  it("pressing Enter in the input submits the typed prompt", () => {
    const editor = makeEditor();
    render(<AiBubbleMenu editor={editor} />);
    fireEvent.click(screen.getByText("AI Rephrase"));
    const input = screen.getByPlaceholderText("How should AI rewrite this?");
    fireEvent.change(input, { target: { value: "make it punchy" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(runSlashAiMock).toHaveBeenCalledTimes(1);
    const call = runSlashAiMock.mock.calls[0]![0] as { prompt: string };
    expect(call.prompt).toBe("make it punchy");
  });

  it("Shift+Enter does NOT submit", () => {
    const editor = makeEditor();
    render(<AiBubbleMenu editor={editor} />);
    fireEvent.click(screen.getByText("AI Rephrase"));
    const input = screen.getByPlaceholderText("How should AI rewrite this?");
    fireEvent.change(input, { target: { value: "still typing" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(runSlashAiMock).not.toHaveBeenCalled();
  });

  it("the submit Enter is defaulted-prevented (no caret move / form submit)", () => {
    const editor = makeEditor();
    render(<AiBubbleMenu editor={editor} />);
    fireEvent.click(screen.getByText("AI Rephrase"));
    const input = screen.getByPlaceholderText("How should AI rewrite this?") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "punchy" } });

    // Dispatch a real native keydown and confirm the handler called
    // preventDefault on it — the default browser action must be suppressed.
    const evt = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    input.dispatchEvent(evt);
    expect(runSlashAiMock).toHaveBeenCalledTimes(1);
    expect(evt.defaultPrevented).toBe(true);
  });

  it("pressing Enter in the /ai generate (portal) prompt submits", () => {
    const editor = makeEditor();
    render(<AiBubbleMenu editor={editor} aiTriggerCount={0} />);
    // Open the portal generate panel via the trigger-count bump.
    const { rerender } = render(<AiBubbleMenu editor={editor} aiTriggerCount={0} />);
    act(() => {
      rerender(<AiBubbleMenu editor={editor} aiTriggerCount={1} />);
    });
    const input = screen.getByPlaceholderText("What should I write?");
    fireEvent.change(input, { target: { value: "write a haiku" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(runSlashAiMock).toHaveBeenCalledTimes(1);
    const call = runSlashAiMock.mock.calls[0]![0] as { prompt: string; mode: string };
    expect(call.prompt).toBe("write a haiku");
    expect(call.mode).toBe("generate");
  });
});

describe("GSD-170: LLM output renders as markdown, not raw text", () => {
  it("renders **bold** markdown as a <strong> element", () => {
    const editor = makeEditor();
    // Drive a markdown token through onToken so the output area fills.
    runSlashAiMock.mockImplementation((args: { onToken: (c: string) => void }) => {
      act(() => {
        args.onToken("This is **bold** text");
      });
      return Promise.resolve(undefined);
    });
    const { container } = render(<AiBubbleMenu editor={editor} />);
    fireEvent.click(screen.getByText("AI Rephrase"));
    const input = screen.getByPlaceholderText("How should AI rewrite this?");
    fireEvent.change(input, { target: { value: "rewrite" } });
    fireEvent.keyDown(input, { key: "Enter" });
    // Markdown must be rendered: Streamdown emits emphasis as an element with
    // data-streamdown="strong" (styled font-semibold), and the raw "**bold**"
    // source must not appear verbatim in the DOM text.
    const strong = container.querySelector('[data-streamdown="strong"]');
    expect(strong?.textContent).toBe("bold");
    expect(container.textContent).not.toContain("**bold**");
  });

  it("renders AI errors as plain text, NOT through the markdown pipeline", () => {
    const editor = makeEditor();
    // Emit an error whose text contains markdown-significant characters
    // (brackets / underscores). It must render verbatim, not be reinterpreted
    // as markdown (e.g. a link or emphasis).
    runSlashAiMock.mockImplementation((args: { onError: (m: string) => void }) => {
      act(() => {
        args.onError("timeout [see _docs_](x)");
      });
      return Promise.resolve(undefined);
    });
    const { container } = render(<AiBubbleMenu editor={editor} />);
    fireEvent.click(screen.getByText("AI Rephrase"));
    const input = screen.getByPlaceholderText("How should AI rewrite this?");
    fireEvent.change(input, { target: { value: "rewrite" } });
    fireEvent.keyDown(input, { key: "Enter" });
    // The raw error string must appear verbatim, and must NOT be turned into a
    // link/emphasis element by the markdown renderer.
    expect(container.textContent).toContain("timeout [see _docs_](x)");
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector('[data-streamdown]')).toBeNull();
  });
});

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

  it("Enter is ignored while a rephrase is streaming (input disabled)", () => {
    const editor = makeEditor();
    // Hold the stream open (never resolve) so mode stays "rephrase-streaming".
    runSlashAiMock.mockImplementation(() => new Promise(() => {}));
    render(<AiBubbleMenu editor={editor} />);
    fireEvent.click(screen.getByText("AI Rephrase"));
    const input = screen.getByPlaceholderText("How should AI rewrite this?");
    fireEvent.change(input, { target: { value: "first" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(runSlashAiMock).toHaveBeenCalledTimes(1);
    // Now streaming — a second Enter must NOT fire another request. This pins
    // the upper boundary of the "Enter submits whenever Send is actionable"
    // gate: Send is replaced by a spinner while streaming, so Enter must be a
    // no-op too (mode === "rephrase-streaming" is excluded).
    fireEvent.change(input, { target: { value: "second" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(runSlashAiMock).toHaveBeenCalledTimes(1);
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

// An editor mock that records exactly what `insertContent(...)` was called
// with, so we can assert the AI output is parsed into ProseMirror nodes rather
// than dropped in as a literal markdown string.
function makeInsertCapturingEditor() {
  const insertContent = vi.fn();
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
    insertContent: (arg: unknown) => {
      insertContent(arg);
      return editor;
    },
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
  return {
    editor: editor as unknown as Parameters<typeof AiBubbleMenu>[0]["editor"],
    insertContent,
  };
}

// Run one full rephrase with the given markdown output, then click a button.
async function rephraseThenClick(
  editor: Parameters<typeof AiBubbleMenu>[0]["editor"],
  markdown: string,
  buttonLabel: RegExp,
) {
  runSlashAiMock.mockImplementation((args: { onToken: (c: string) => void }) => {
    act(() => {
      args.onToken(markdown);
    });
    return Promise.resolve(undefined);
  });
  render(<AiBubbleMenu editor={editor} />);
  fireEvent.click(screen.getByText("AI Rephrase"));
  const input = screen.getByPlaceholderText("How should AI rewrite this?");
  fireEvent.change(input, { target: { value: "rewrite" } });
  fireEvent.keyDown(input, { key: "Enter" });
  // Flush the runSlashAi promise's `.finally()` so mode advances to
  // "rephrase-done", which is where the Replace/Append buttons render.
  await act(async () => { await Promise.resolve(); });
  // Now in rephrase-done mode: click the requested action button.
  fireEvent.click(screen.getByText(buttonLabel));
}

// Collect every ProseMirror node type present anywhere in a JSONContent tree.
function collectNodeTypes(node: unknown, out: Set<string> = new Set()): Set<string> {
  if (!node || typeof node !== "object") return out;
  const n = node as { type?: string; content?: unknown[]; marks?: { type?: string }[] };
  if (typeof n.type === "string") out.add(n.type);
  for (const mark of n.marks ?? []) if (mark.type) out.add(mark.type);
  for (const child of n.content ?? []) collectNodeTypes(child, out);
  return out;
}

describe("GSD-170: accepting AI output inserts formatted nodes, not raw markdown", () => {
  it("Replace inserts parsed ProseMirror content, not the literal **bold** string", async () => {
    const { editor, insertContent } = makeInsertCapturingEditor();
    await rephraseThenClick(editor, "This is **bold** and _italic_ text", /Replace/);

    expect(insertContent).toHaveBeenCalledTimes(1);
    const arg = insertContent.mock.calls[0]![0];
    // Must NOT be the raw markdown string.
    expect(typeof arg).not.toBe("string");
    // Must be a ProseMirror JSON doc carrying a bold mark.
    const types = collectNodeTypes(arg);
    expect(types.has("bold")).toBe(true);
    expect(types.has("italic")).toBe(true);
    // Belt-and-suspenders: the serialized doc must not contain the literal
    // markdown asterisks as text content.
    expect(JSON.stringify(arg)).not.toContain("**bold**");
  });

  it("Append inserts parsed heading/list nodes, not literal markdown", async () => {
    const { editor, insertContent } = makeInsertCapturingEditor();
    await rephraseThenClick(editor, "# Title\n\n- one\n- two", /Append/);

    expect(insertContent).toHaveBeenCalledTimes(1);
    const arg = insertContent.mock.calls[0]![0];
    expect(typeof arg).not.toBe("string");
    const types = collectNodeTypes(arg);
    expect(types.has("heading")).toBe(true);
    expect(types.has("bulletList")).toBe(true);
    expect(types.has("listItem")).toBe(true);
    expect(JSON.stringify(arg)).not.toContain("# Title");
  });
});

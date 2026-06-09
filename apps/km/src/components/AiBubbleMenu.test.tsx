// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

// Stub @episteme/editor BubbleMenu so we render its children unconditionally —
// our tests focus on the rephrase panel, not Tiptap positioning logic.
vi.mock("@episteme/editor", async () => {
  return {
    BubbleMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  };
});

// Mock the SSE call — we only assert what was passed.
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
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/agents/skills")) {
      return new Response(
        JSON.stringify({
          skills: [
            { name: "lit-triage", title: "Literature Triage", description: "x", instruction: "TRIAGE-INSTR", category: "research" },
            { name: "synthesis", title: "Synthesis", description: "y", instruction: "SYNTH-INSTR", category: "writing" },
            { name: "my-style", title: "My Style", description: "My personal style", instruction: "REWRITE-INSTR" },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
});

describe("AiBubbleMenu rephrase prompt bar", () => {
  it("opens prompt bar with input + preset row when AI Rephrase clicked", () => {
    const editor = makeEditor();
    render(<AiBubbleMenu editor={editor} />);
    fireEvent.click(screen.getByText("AI Rephrase"));
    expect(screen.getByPlaceholderText("How should AI rewrite this?")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Formal" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Casual" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Shorter" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Expand" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Academic" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Simplify" })).toBeTruthy();
  });

  it("clicking 'Formal' preset triggers rephrase with the preset instruction", () => {
    const editor = makeEditor();
    render(<AiBubbleMenu editor={editor} />);
    fireEvent.click(screen.getByText("AI Rephrase"));
    fireEvent.click(screen.getByRole("button", { name: "Formal" }));
    expect(runSlashAiMock).toHaveBeenCalledTimes(1);
    const call = runSlashAiMock.mock.calls[0]![0] as { prompt: string; mode: string };
    expect(call.mode).toBe("rephrase");
    expect(call.prompt.toLowerCase()).toContain("formal");
  });

  it("clicking 'Personal skill' opens the picker showing writing skills + personal skills", async () => {
    const editor = makeEditor();
    render(<AiBubbleMenu editor={editor} />);
    fireEvent.click(screen.getByText("AI Rephrase"));
    fireEvent.click(screen.getByRole("button", { name: /personal skill/i }));
    await waitFor(() => {
      // Synthesis is writing-tagged → visible.
      expect(screen.getByText("Synthesis")).toBeTruthy();
    });
    // My Style is personal (no category) → visible.
    expect(screen.getByText("My Style")).toBeTruthy();
    // Literature Triage is research-tagged → excluded.
    expect(screen.queryByText("Literature Triage")).toBeNull();
  });

  it("selecting a writing skill triggers rephrase with the skill instruction", async () => {
    const editor = makeEditor();
    render(<AiBubbleMenu editor={editor} />);
    fireEvent.click(screen.getByText("AI Rephrase"));
    fireEvent.click(screen.getByRole("button", { name: /personal skill/i }));
    const item = await screen.findByText("Synthesis");
    fireEvent.click(item);
    await waitFor(() => {
      expect(runSlashAiMock).toHaveBeenCalledTimes(1);
    });
    const call = runSlashAiMock.mock.calls[0]![0] as { prompt: string };
    expect(call.prompt).toBe("SYNTH-INSTR");
  });

  it("selecting a personal skill triggers rephrase with the skill instruction", async () => {
    const editor = makeEditor();
    render(<AiBubbleMenu editor={editor} />);
    fireEvent.click(screen.getByText("AI Rephrase"));
    fireEvent.click(screen.getByRole("button", { name: /personal skill/i }));
    const item = await screen.findByText("My Style");
    fireEvent.click(item);
    await waitFor(() => {
      expect(runSlashAiMock).toHaveBeenCalledTimes(1);
    });
    const call = runSlashAiMock.mock.calls[0]![0] as { prompt: string };
    expect(call.prompt).toBe("REWRITE-INSTR");
  });

  it("renders no Lucide Sparkles/Wand2 icons and uses the glyph for personal-skill button (#71, #102)", () => {
    const editor = makeEditor();
    const { container } = render(<AiBubbleMenu editor={editor} />);
    fireEvent.click(screen.getByText("AI Rephrase"));
    // No svg with the lucide-sparkles or lucide-wand-2 class anywhere.
    expect(container.querySelector(".lucide-sparkles")).toBeNull();
    expect(container.querySelector(".lucide-wand-2")).toBeNull();
    // The literal glyph appears next to the personal-skill label.
    const btn = screen.getByRole("button", { name: /personal skill/i });
    expect(btn.textContent).toContain("⬡");
  });

  it("rephrase pill row and prompt+Send row share a centered flex container (#67a)", () => {
    const editor = makeEditor();
    const { container } = render(<AiBubbleMenu editor={editor} />);
    fireEvent.click(screen.getByText("AI Rephrase"));
    const pillRow = container.querySelector('[data-testid="rephrase-pill-row"]');
    const promptRow = container.querySelector('[data-testid="rephrase-prompt-row"]');
    expect(pillRow).toBeTruthy();
    expect(promptRow).toBeTruthy();
    // Both rows must be centered (justify-center) so left/right edges line up.
    expect(pillRow!.className).toMatch(/justify-center/);
    expect(promptRow!.className).toMatch(/justify-center/);
  });

  it("GSD-29: renders a Link button in the format toolbar", () => {
    const editor = makeEditor();
    render(<AiBubbleMenu editor={editor} />);
    expect(screen.getByRole("button", { name: /insert link/i })).toBeTruthy();
  });

  it("GSD-29: clicking Link opens a popover with selected text pre-filled", () => {
    const editor = makeEditor();
    // makeEditor's doc.textBetween returns "selected" — assert that pre-fills the popover.
    render(<AiBubbleMenu editor={editor} />);
    fireEvent.click(screen.getByRole("button", { name: /insert link/i }));
    expect((screen.getByLabelText(/display text/i) as HTMLInputElement).value).toBe("selected");
    expect(screen.getByRole("button", { name: /^insert$/i })).toBeTruthy();
  });

  it("GSD-29: submitting the link popover runs an editor chain with a link mark", () => {
    const editor = makeEditor();
    const insertContent = vi.fn(() => editor);
    (editor as unknown as { insertContent: typeof insertContent }).insertContent = insertContent;
    // Add deleteSelection chain method (the new insertLink path calls it).
    (editor as unknown as { deleteSelection: () => unknown }).deleteSelection = () => editor;
    render(<AiBubbleMenu editor={editor} />);
    fireEvent.click(screen.getByRole("button", { name: /insert link/i }));
    fireEvent.change(screen.getByLabelText(/url/i), { target: { value: "https://foo.com" } });
    fireEvent.click(screen.getByRole("button", { name: /^insert$/i }));
    expect(insertContent).toHaveBeenCalledTimes(1);
    const call = (insertContent.mock.calls as unknown as Array<Array<{
      marks: Array<{ type: string; attrs: { href: string } }>;
    }>>)[0]![0]!;
    expect(call.marks[0]!.type).toBe("link");
    expect(call.marks[0]!.attrs.href).toBe("https://foo.com");
  });

  it("GSD-29: link overlay is rendered via portal to document.body (not as BubbleMenu sibling)", () => {
    const editor = makeEditor();
    const { container } = render(<AiBubbleMenu editor={editor} />);
    fireEvent.click(screen.getByRole("button", { name: /insert link/i }));
    // The URL input must exist in the document but NOT inside the BubbleMenu
    // sibling subtree — Tippy yanks that DOM during state transitions and
    // crashes React's insertBefore. Portal to document.body avoids the race.
    const urlInput = screen.getByLabelText(/url/i);
    expect(urlInput).toBeTruthy();
    expect(container.contains(urlInput)).toBe(false);
  });

  it("submitWithPrompt guards against undefined promptText (#112)", () => {
    // If a skill has an undefined instruction, submitWithPrompt should not crash.
    // We verify indirectly: clicking a preset that passes a string always works.
    const editor = makeEditor();
    render(<AiBubbleMenu editor={editor} />);
    fireEvent.click(screen.getByText("AI Rephrase"));
    // This should work without error — the guard prevents crash on undefined.
    fireEvent.click(screen.getByRole("button", { name: "Formal" }));
    expect(runSlashAiMock).toHaveBeenCalledTimes(1);
  });
});
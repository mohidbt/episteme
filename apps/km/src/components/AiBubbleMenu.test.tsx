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
            { name: "lit-triage", title: "Literature Triage", description: "x", instruction: "TRIAGE-INSTR" },
            { name: "synthesis", title: "Synthesis", description: "y", instruction: "SYNTH-INSTR" },
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

  it("clicking 'Personal skill' opens the picker with skills from /api/agents/skills", async () => {
    const editor = makeEditor();
    render(<AiBubbleMenu editor={editor} />);
    fireEvent.click(screen.getByText("AI Rephrase"));
    fireEvent.click(screen.getByRole("button", { name: /personal skill/i }));
    await waitFor(() => {
      expect(screen.getByText("Literature Triage")).toBeTruthy();
      expect(screen.getByText("Synthesis")).toBeTruthy();
    });
  });

  it("selecting a skill triggers rephrase with the skill instruction", async () => {
    const editor = makeEditor();
    render(<AiBubbleMenu editor={editor} />);
    fireEvent.click(screen.getByText("AI Rephrase"));
    fireEvent.click(screen.getByRole("button", { name: /personal skill/i }));
    const item = await screen.findByText("Literature Triage");
    fireEvent.click(item);
    await waitFor(() => {
      expect(runSlashAiMock).toHaveBeenCalledTimes(1);
    });
    const call = runSlashAiMock.mock.calls[0]![0] as { prompt: string };
    expect(call.prompt).toBe("TRIAGE-INSTR");
  });
});

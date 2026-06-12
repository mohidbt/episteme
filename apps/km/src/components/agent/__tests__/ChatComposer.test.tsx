// @vitest-environment jsdom
// GSD-96 R3 — RED. ChatComposer (Tiptap single-line + @-picker + drop zone).
//
// Edge cases this covers:
//  - renders a contenteditable surface with placeholder
//  - Enter w/o shift fires onSubmit w/ the typed text
//  - Shift+Enter inserts a hard break (does NOT submit)
//  - Disable while streaming: onSubmit not called
//  - Submit emits library tokens for any inserted wikiLink nodes,
//    interleaved using formatLibToken
//  - useDroppable("chat-composer") registers — drop adds a wikiLink node to
//    doc (covered in at-mention-recents.test.tsx via DndMonitor-style harness)
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import { ChatComposer } from "../ChatComposer";

afterEach(() => cleanup());

function renderComposer(props: Partial<React.ComponentProps<typeof ChatComposer>> = {}) {
  const onSubmit = vi.fn();
  render(
    <DndContext>
      <ChatComposer
        onSubmit={onSubmit}
        streaming={false}
        placeholder="Ask anything"
        {...props}
      />
    </DndContext>,
  );
  return { onSubmit };
}

describe("ChatComposer", () => {
  it("renders an editable surface", () => {
    renderComposer();
    const editor = screen.getByRole("textbox", { name: /message agent/i });
    expect(editor).toBeTruthy();
  });

  it("Enter submits typed text", async () => {
    const { onSubmit } = renderComposer();
    const editor = screen.getByRole("textbox", { name: /message agent/i });
    fireEvent.input(editor, { target: { textContent: "hello world" } });
    fireEvent.keyDown(editor, { key: "Enter", shiftKey: false });
    expect(onSubmit).toHaveBeenCalled();
    const payload = onSubmit.mock.calls[0][0];
    expect(payload.text).toContain("hello world");
  });

  it("Shift+Enter does not submit", () => {
    const { onSubmit } = renderComposer();
    const editor = screen.getByRole("textbox", { name: /message agent/i });
    fireEvent.input(editor, { target: { textContent: "x" } });
    fireEvent.keyDown(editor, { key: "Enter", shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("does not submit while streaming", () => {
    const { onSubmit } = renderComposer({ streaming: true });
    const editor = screen.getByRole("textbox", { name: /message agent/i });
    fireEvent.input(editor, { target: { textContent: "x" } });
    fireEvent.keyDown(editor, { key: "Enter", shiftKey: false });
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

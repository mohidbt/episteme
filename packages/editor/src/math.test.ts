/**
 * GSD-234: LaTeX rendering in the notes editor.
 *
 * Math stays plain text in the document (`$x$` / `$$x$$`); the Mathematics
 * extension paints KaTeX over it via decorations. That keeps the markdown
 * round-trip byte-identical — no new node type, no new serializer.
 *
 * The `$` character is common prose (prices), so the guards below are the
 * point of the feature, not extras.
 */
import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { editorExtensions } from "./extensions";

/**
 * Tiptap emits `create` on a macrotask, and the decoration pass rides on it —
 * so every assertion here waits one tick, exactly like the first paint does.
 * No transaction is dispatched: seeing math means it rendered without the user
 * touching the document.
 */
async function mount(markdown: string): Promise<Editor> {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({ element, extensions: editorExtensions(), content: markdown });
  await new Promise((resolve) => setTimeout(resolve, 0));
  return editor;
}

function renderedMath(editor: Editor): string[] {
  return Array.from(
    editor.view.dom.querySelectorAll(".Tiptap-mathematics-render"),
  ).map((el) => el.textContent ?? "");
}

describe("math rendering", () => {
  it("renders inline $...$ as KaTeX", async () => {
    const editor = await mount("Einstein said $E = mc^2$ once.");
    expect(editor.view.dom.querySelectorAll(".katex").length).toBe(1);
    expect(renderedMath(editor).length).toBe(1);
    editor.destroy();
  });

  it("renders block $$...$$ exactly once (no nested inline match)", async () => {
    const editor = await mount("Intro\n\n$$\\sum_{i=1}^n x_i$$");
    expect(renderedMath(editor).length).toBe(1);
    editor.destroy();
  });

  it("shows the LaTeX source while the caret sits inside it", async () => {
    const editor = await mount("Einstein said $E = mc^2$ once.");
    expect(renderedMath(editor).length).toBe(1);
    // "$" of "$E = mc^2$" starts at position 15 (1 for <p>, 14 chars of prose).
    editor.commands.setTextSelection(18);
    expect(renderedMath(editor)).toEqual([]);
    editor.commands.setTextSelection(1);
    expect(renderedMath(editor).length).toBe(1);
    editor.destroy();
  });

  it("leaves currency amounts alone", async () => {
    const editor = await mount("It costs $5 and $10 today.");
    expect(renderedMath(editor)).toEqual([]);
    editor.destroy();
  });

  it("does not render inside a code block", async () => {
    const editor = await mount("```\n$x^2$\n```");
    expect(renderedMath(editor)).toEqual([]);
    editor.destroy();
  });

  it("does not render inside inline code", async () => {
    const editor = await mount("Write `$x^2$` for math.");
    expect(renderedMath(editor)).toEqual([]);
    editor.destroy();
  });

  it("renders invalid LaTeX as-is instead of throwing", async () => {
    const editor = await mount("Broken $\\frac{1$ here.");
    expect(() => editor.view.dom.innerHTML).not.toThrow();
    editor.destroy();
  });

  it("keeps math as plain text in the document (no new node type)", async () => {
    const md = "Greek $\\alpha_i$ and $$\\frac{a}{b}$$ stay put.";
    const editor = await mount(md);
    expect(editor.getText()).toBe(md);
    expect(editor.getJSON().content?.[0]?.content?.[0]?.type).toBe("text");
    editor.destroy();
  });
});

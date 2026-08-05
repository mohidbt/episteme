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
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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

  /**
   * The guest welcome note is the only place math is advertised to a new user,
   * so it is also the only place a silent regression would be invisible: a
   * markdown-pipeline change that ate the delimiters would just render prose.
   * Reads the real seed file across the package boundary on purpose — asserting
   * against a copy of the sample would pass while the shipped note was broken.
   */
  it("renders the math sample in the seeded welcome note", async () => {
    // Anchored to this file, not to cwd — the suite has to resolve the same
    // way whether it is run from the package or from the repo root. (Passing a
    // URL object to readFileSync does not work here: jsdom's global URL is not
    // the one node:fs recognises.)
    const md = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../../../apps/km/public/seed/welcome-note.md"),
      "utf8",
    );
    const first = await mount(md);
    expect(first.view.dom.querySelectorAll(".katex").length).toBeGreaterThanOrEqual(2);

    // The first autosave rewrites the note in the serializer's own escaping
    // (`\pi` is stored as `\\pi`), so what a returning user opens is this
    // string, not the seed file. Math has to survive that round trip — a
    // control sequence markdown treats as an escape (`\,` escapes a comma) is
    // swallowed on the way in and gone for good.
    const stored = (first.storage as any).markdown.getMarkdown() as string;
    const second = await mount(stored);
    expect(second.getText()).toBe(first.getText());
    expect(second.view.dom.querySelectorAll(".katex").length).toBeGreaterThanOrEqual(2);
    first.destroy();
    second.destroy();
  });

  it("keeps math as plain text in the document (no new node type)", async () => {
    const md = "Greek $\\alpha_i$ and $$\\frac{a}{b}$$ stay put.";
    const editor = await mount(md);
    expect(editor.getText()).toBe(md);
    expect(editor.getJSON().content?.[0]?.content?.[0]?.type).toBe("text");
    editor.destroy();
  });
});

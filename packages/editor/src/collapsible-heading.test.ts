/**
 * Task #2 — Obsidian-style collapsible headings.
 *
 * A heading node carries an optional `collapsed` boolean attribute. When true,
 * subsequent sibling block nodes are hidden from view (via ProseMirror
 * decoration adding `display: none` to their DOM) until the next heading of
 * the same or higher level (i.e. equal- or smaller-numbered level: H2 folds
 * H3/H4/etc and paragraphs, but stops at the next H1 or H2).
 */
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { editorExtensions } from "./extensions";

function makeEditor(content: object) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const editor = new Editor({
    element: host,
    extensions: editorExtensions(),
    content,
  });
  return { editor, host };
}

describe("CollapsibleHeading", () => {
  it("heading node accepts a `collapsed` attribute", () => {
    const { editor } = makeEditor({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2, collapsed: true }, content: [{ type: "text", text: "Title" }] },
        { type: "paragraph", content: [{ type: "text", text: "body" }] },
      ],
    });
    const json = editor.getJSON();
    editor.destroy();
    const h = json.content?.[0];
    expect(h?.type).toBe("heading");
    expect(h?.attrs?.collapsed).toBe(true);
  });

  it("when heading is collapsed, following paragraph is hidden in DOM", () => {
    const { editor, host } = makeEditor({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2, collapsed: true }, content: [{ type: "text", text: "Title" }] },
        { type: "paragraph", content: [{ type: "text", text: "body" }] },
      ],
    });
    const paragraphs = host.querySelectorAll("p");
    const hidden = Array.from(paragraphs).filter((p) => {
      return p.style.display === "none" || p.getAttribute("data-collapsed") === "true";
    });
    editor.destroy();
    host.remove();
    expect(hidden.length).toBeGreaterThan(0);
  });

  it("when heading is NOT collapsed, following paragraph stays visible", () => {
    const { editor, host } = makeEditor({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2, collapsed: false }, content: [{ type: "text", text: "Title" }] },
        { type: "paragraph", content: [{ type: "text", text: "body" }] },
      ],
    });
    const paragraphs = host.querySelectorAll("p");
    const visible = Array.from(paragraphs).filter(
      (p) => p.style.display !== "none" && p.getAttribute("data-collapsed") !== "true",
    );
    editor.destroy();
    host.remove();
    expect(visible.length).toBeGreaterThan(0);
  });

  it("collapse stops at next heading of same or higher level", () => {
    const { editor, host } = makeEditor({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2, collapsed: true }, content: [{ type: "text", text: "A" }] },
        { type: "paragraph", content: [{ type: "text", text: "under A" }] },
        { type: "heading", attrs: { level: 2, collapsed: false }, content: [{ type: "text", text: "B" }] },
        { type: "paragraph", content: [{ type: "text", text: "under B" }] },
      ],
    });
    const paragraphs = Array.from(host.querySelectorAll("p"));
    const findByText = (txt: string) => paragraphs.find((p) => p.textContent?.includes(txt));
    const underA = findByText("under A");
    const underB = findByText("under B");
    editor.destroy();
    host.remove();
    expect(underA?.style.display).toBe("none");
    // "under B" is after a non-collapsed heading B at the same level → visible
    expect(underB?.style.display).not.toBe("none");
  });
});

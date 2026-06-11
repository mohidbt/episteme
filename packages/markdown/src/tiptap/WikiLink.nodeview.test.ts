// @vitest-environment jsdom
import { describe, expect, it, afterEach } from "vitest";
import { Editor, type Content } from "@tiptap/core";
import { createExtensions } from "../extensions";
import { WikiLink } from "./WikiLink";

/**
 * GSD-89 — NodeView render contract.
 *
 * Bug 1: the label text must live inside a `<span class="wiki-link__label">`
 * child, not as a bare Text node sibling of the SVG icon. The inline-flex
 * parent + raw-text-sibling layout caused `text-overflow: ellipsis` to fail
 * (raw text becomes an anonymous flex item that overflows mid-glyph).
 *
 * Bug 2: the NodeView wrapper span must carry `contenteditable="false"`.
 * ProseMirror relies on this attribute to treat the NodeView DOM as a single
 * atomic leaf for cursor mapping. Without it, ArrowRight steps into the text
 * child rather than past the chip.
 */

function makeMountedEditor(content: Content) {
  const mount = document.createElement("div");
  document.body.appendChild(mount);
  const editor = new Editor({
    element: mount,
    extensions: [...createExtensions(), WikiLink],
    content,
  });
  return { editor, mount };
}

const mounted: Editor[] = [];

afterEach(() => {
  while (mounted.length) {
    const e = mounted.pop();
    try {
      e?.destroy();
    } catch {
      /* ignore */
    }
  }
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
});

describe("GSD-89 WikiLink NodeView DOM contract", () => {
  it("wraps the label in a <span class=\"wiki-link__label\"> child", () => {
    const { editor, mount } = makeMountedEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "wikiLink",
              attrs: {
                title: "Some Long Title That Should Truncate",
                alias: null,
                targetKind: "note",
                targetId: null,
                displayTitle: null,
              },
            },
          ],
        },
      ],
    });
    mounted.push(editor);

    const chip = mount.querySelector('[data-type="wiki-link"]');
    expect(chip).toBeTruthy();
    const labelSpan = chip!.querySelector("span.wiki-link__label");
    expect(labelSpan).toBeTruthy();
    expect(labelSpan!.textContent).toBe("Some Long Title That Should Truncate");
  });

  it("sets contenteditable=\"false\" on the NodeView wrapper span (atom cursor invariant)", () => {
    const { editor, mount } = makeMountedEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "wikiLink",
              attrs: {
                title: "X",
                alias: null,
                targetKind: "note",
                targetId: null,
                displayTitle: null,
              },
            },
          ],
        },
      ],
    });
    mounted.push(editor);

    const chip = mount.querySelector('[data-type="wiki-link"]') as HTMLElement | null;
    expect(chip).toBeTruthy();
    expect(chip!.getAttribute("contenteditable")).toBe("false");
  });

  it("preserves contenteditable=\"false\" after a self-heal attr update", () => {
    // Self-heal rewrites attrs on a wikiLink with a known prefix in its title.
    // This triggers NodeView.update() → buildDom rebuild. The rebuilt wrapper
    // must keep the contenteditable invariant.
    const { editor, mount } = makeMountedEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "wikiLink",
              attrs: {
                title: "p:Foo",
                alias: null,
                targetKind: null,
                targetId: null,
                displayTitle: null,
              },
            },
          ],
        },
      ],
    });
    mounted.push(editor);

    // After self-heal the chip should have targetKind="paper", title="Foo".
    const chip = mount.querySelector('[data-type="wiki-link"]') as HTMLElement | null;
    expect(chip).toBeTruthy();
    expect(chip!.getAttribute("contenteditable")).toBe("false");
    const labelSpan = chip!.querySelector("span.wiki-link__label");
    expect(labelSpan).toBeTruthy();
  });
});

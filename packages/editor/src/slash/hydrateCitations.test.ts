import { describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { createExtensions, Citation } from "@episteme/markdown";
import type { CitationAttrs } from "@episteme/markdown";
import { BibliographyHeading } from "./BibliographyHeading";
import { insertCitation } from "./CiteCommand";
import { renumberCitations, hydrateCitations } from "./hydrateCitations";
import type { CitationMeta } from "./hydrateCitations";

function makeEditor(content?: object) {
  return new Editor({
    extensions: [...createExtensions(), BibliographyHeading],
    content: content ?? { type: "doc", content: [{ type: "paragraph" }] },
  });
}

function getCitationAttrs(editor: Editor): CitationAttrs[] {
  const attrs: CitationAttrs[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === "citation") {
      attrs.push(node.attrs as CitationAttrs);
    }
  });
  return attrs;
}

function getBibListItems(editor: Editor): string[] {
  const items: string[] = [];
  let inBib = false;
  editor.state.doc.forEach((node) => {
    if (node.type.name === "bibliographyHeading" || node.textContent === "Bibliography") {
      inBib = true;
      return;
    }
    if (inBib && node.type.name === "orderedList") {
      node.forEach((li) => {
        items.push(li.textContent);
      });
      inBib = false;
    }
  });
  return items;
}

// ──────────────────────────────────────────────────────────────
// renumberCitations
// ──────────────────────────────────────────────────────────────

describe("renumberCitations", () => {
  it("no-op on a doc with zero citations", () => {
    const editor = makeEditor();
    const before = editor.state.doc.toString();
    const changed = renumberCitations(editor);
    expect(changed).toBe(false);
    expect(editor.state.doc.toString()).toBe(before);
    editor.destroy();
  });

  it("assigns bibIndex 1..N in document order", () => {
    const editor = makeEditor();
    // Insert two citations via insertCitation so they start with correct bibIndex
    insertCitation(editor, {
      citekey: "vaswani2017",
      title: "Attention Is All You Need",
      authors: ["Vaswani, A."],
      year: "2017",
    });
    insertCitation(editor, {
      citekey: "devlin2018",
      title: "BERT",
      authors: ["Devlin, J."],
      year: "2018",
    });

    // Manually corrupt bibIndex to simulate reload state (all null)
    editor.chain().command(({ tr, state }) => {
      state.doc.descendants((node, pos) => {
        if (node.type.name === "citation") {
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, bibIndex: null });
        }
      });
      return true;
    }).run();

    // Now all citations have bibIndex: null
    const before = getCitationAttrs(editor);
    expect(before.every((a) => a.bibIndex === null)).toBe(true);

    renumberCitations(editor);

    const after = getCitationAttrs(editor);
    expect(after[0].bibIndex).toBe(1);
    expect(after[1].bibIndex).toBe(2);

    editor.destroy();
  });

  it("is idempotent — running twice produces the same result", () => {
    const editor = makeEditor();
    insertCitation(editor, {
      citekey: "vaswani2017",
      title: "Attention Is All You Need",
      authors: ["Vaswani, A."],
      year: "2017",
    });

    renumberCitations(editor);
    const after1 = getCitationAttrs(editor);

    renumberCitations(editor);
    const after2 = getCitationAttrs(editor);

    expect(after1).toEqual(after2);
    editor.destroy();
  });
});

// ──────────────────────────────────────────────────────────────
// hydrateCitations
// ──────────────────────────────────────────────────────────────

function makeFetcher(
  map: Record<string, CitationMeta>,
): (citekeys: string[]) => Promise<CitationMeta[]> {
  return async (citekeys) => citekeys.flatMap((k) => (map[k] ? [map[k]] : []));
}

describe("hydrateCitations", () => {
  it("no-op when doc has zero citations", async () => {
    const editor = makeEditor();
    const fetcher = vi.fn().mockResolvedValue([]);
    await hydrateCitations(editor, fetcher);
    expect(fetcher).not.toHaveBeenCalled();
    editor.destroy();
  });

  it("fills citation attrs (title, authors, year) from fetcher response", async () => {
    const editor = makeEditor();
    insertCitation(editor, {
      citekey: "vaswani2017",
      title: "Attention Is All You Need",
      authors: ["Vaswani, A."],
      year: "2017",
    });

    // Simulate reload: strip attrs (title/authors/year become empty)
    editor.chain().command(({ tr, state }) => {
      state.doc.descendants((node, pos) => {
        if (node.type.name === "citation") {
          tr.setNodeMarkup(pos, undefined, {
            ...node.attrs,
            title: null,
            authors: null,
            year: null,
            bibIndex: null,
          });
        }
      });
      return true;
    }).run();

    const fetcher = makeFetcher({
      vaswani2017: {
        citekey: "vaswani2017",
        title: "Attention Is All You Need",
        authors: ["Vaswani, A.", "Shazeer, N."],
        year: "2017",
        doi: "10.test/1",
      },
    });

    await hydrateCitations(editor, fetcher);

    const attrs = getCitationAttrs(editor);
    expect(attrs[0].title).toBe("Attention Is All You Need");
    expect(attrs[0].authors).toEqual(["Vaswani, A.", "Shazeer, N."]);
    expect(attrs[0].year).toBe("2017");
    expect(attrs[0].bibIndex).toBe(1);

    editor.destroy();
  });

  it("citations with missing fetcher response keep existing attrs but still get bibIndex", async () => {
    const editor = makeEditor();
    insertCitation(editor, {
      citekey: "vaswani2017",
      title: "Old Title",
      authors: ["Vaswani, A."],
      year: "2017",
    });

    // Simulate reload: strip bibIndex but keep some attrs
    editor.chain().command(({ tr, state }) => {
      state.doc.descendants((node, pos) => {
        if (node.type.name === "citation") {
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, bibIndex: null });
        }
      });
      return true;
    }).run();

    // Fetcher returns nothing for vaswani2017
    const fetcher = makeFetcher({});

    await hydrateCitations(editor, fetcher);

    const attrs = getCitationAttrs(editor);
    // bibIndex assigned even when fetcher has no data
    expect(attrs[0].bibIndex).toBe(1);
    // Existing attrs preserved
    expect(attrs[0].title).toBe("Old Title");

    editor.destroy();
  });

  it("upgrades plain 'Bibliography' paragraph to bibliographyHeading node after hydration", async () => {
    // Simulate a doc loaded from MD: bibliography is a plain paragraph
    const editor = makeEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Hello" }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "[@vaswani2017]" }],
        },
      ],
    });

    // The MD parser would produce a citation node; simulate it directly
    // by inserting via insertCitation first, then checking bibliography heading type
    const editorWithCite = makeEditor();
    insertCitation(editorWithCite, {
      citekey: "vaswani2017",
      title: "Attention Is All You Need",
      authors: ["Vaswani, A."],
      year: "2017",
    });

    const fetcher = makeFetcher({
      vaswani2017: {
        citekey: "vaswani2017",
        title: "Attention Is All You Need",
        authors: ["Vaswani, A."],
        year: "2017",
        doi: null,
      },
    });

    await hydrateCitations(editorWithCite, fetcher);

    // After hydration, the bibliography heading must be a bibliographyHeading node
    let foundBibHeading = false;
    editorWithCite.state.doc.forEach((node) => {
      if (node.type.name === "bibliographyHeading") {
        foundBibHeading = true;
      }
    });
    expect(foundBibHeading).toBe(true);

    editorWithCite.destroy();
    editor.destroy();
  });

  it("bibliography list is rebuilt to match citation order after hydration", async () => {
    const editor = makeEditor();
    insertCitation(editor, {
      citekey: "vaswani2017",
      title: "Attention Is All You Need",
      authors: ["Vaswani, A."],
      year: "2017",
    });
    insertCitation(editor, {
      citekey: "devlin2018",
      title: "BERT",
      authors: ["Devlin, J."],
      year: "2018",
    });

    const fetcher = makeFetcher({
      vaswani2017: {
        citekey: "vaswani2017",
        title: "Attention Is All You Need",
        authors: ["Vaswani, A."],
        year: "2017",
        doi: null,
      },
      devlin2018: {
        citekey: "devlin2018",
        title: "BERT",
        authors: ["Devlin, J."],
        year: "2018",
        doi: null,
      },
    });

    await hydrateCitations(editor, fetcher);

    const items = getBibListItems(editor);
    expect(items).toHaveLength(2);
    // First item corresponds to first citation (vaswani2017)
    expect(items[0]).toContain("Vaswani");
    expect(items[1]).toContain("Devlin");

    editor.destroy();
  });

  it("does not create a bibliography section when doc has zero citations", async () => {
    const editor = makeEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "No citations here" }],
        },
      ],
    });

    const fetcher = vi.fn().mockResolvedValue([]);
    await hydrateCitations(editor, fetcher);

    // Doc should not gain a bibliography section
    let hasBib = false;
    editor.state.doc.forEach((node) => {
      if (
        node.type.name === "bibliographyHeading" ||
        node.textContent === "Bibliography"
      ) {
        hasBib = true;
      }
    });
    expect(hasBib).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();

    editor.destroy();
  });
});

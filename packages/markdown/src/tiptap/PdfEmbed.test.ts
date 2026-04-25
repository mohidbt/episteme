import { describe, expect, it } from "vitest";
import { Editor, type Content } from "@tiptap/core";
import { mdToProseMirror, proseMirrorToMd, createExtensions } from "../index.js";
import type { JSONContent } from "@tiptap/core";

function makeEditor(content: Content) {
  // PdfEmbed is already in createExtensions() — don't add it twice
  return new Editor({
    extensions: createExtensions(),
    content,
  });
}

const samplePdfDoc: JSONContent = {
  type: "doc",
  content: [
    {
      type: "pdfEmbed",
      attrs: {
        pdfId: "123",
        title: "Transformers Survey",
        page: null,
      },
    },
  ],
};

const samplePdfDocWithPage: JSONContent = {
  type: "doc",
  content: [
    {
      type: "pdfEmbed",
      attrs: {
        pdfId: "abc-456",
        title: 'A "Quoted" Title',
        page: 7,
      },
    },
  ],
};

describe("PdfEmbed node — renderHTML", () => {
  it("emits wrapper div with data-type=pdf-embed and data-pdf-id", () => {
    const editor = makeEditor(samplePdfDoc);
    const html = editor.getHTML();
    editor.destroy();
    expect(html).toContain('data-type="pdf-embed"');
    expect(html).toContain('data-pdf-id="123"');
  });

  it("emits Open in reader link pointing to /p/:pdfId", () => {
    const editor = makeEditor(samplePdfDoc);
    const html = editor.getHTML();
    editor.destroy();
    expect(html).toContain('href="/p/123"');
    expect(html).toContain("Open in reader");
  });

  it("includes page fragment in href when page is set", () => {
    const editor = makeEditor(samplePdfDocWithPage);
    const html = editor.getHTML();
    editor.destroy();
    expect(html).toContain('href="/p/abc-456#page=7"');
  });

  it("no page fragment when page is null", () => {
    const editor = makeEditor(samplePdfDoc);
    const html = editor.getHTML();
    editor.destroy();
    expect(html).not.toContain("#page=");
  });

  it("renders title text inside the card", () => {
    const editor = makeEditor(samplePdfDoc);
    const html = editor.getHTML();
    editor.destroy();
    expect(html).toContain("Transformers Survey");
  });
});

describe("PdfEmbed node — MD serialization", () => {
  it("serializes to HTML comment form", () => {
    const md = proseMirrorToMd(samplePdfDoc);
    expect(md).toContain('<!-- episteme:pdf id="123" title="Transformers Survey" -->');
  });

  it("serializes with page attr when page is set", () => {
    const md = proseMirrorToMd(samplePdfDocWithPage);
    expect(md).toContain('page="7"');
    expect(md).toContain('id="abc-456"');
  });

  it("escapes double-quotes in title as &quot;", () => {
    const md = proseMirrorToMd(samplePdfDocWithPage);
    // The raw " chars in the title must be encoded as &quot;
    expect(md).toContain("&quot;");
    // Extract the title value: from title=" to next closing " — must not contain raw "
    const titleMatch = /title="([^"]*)"/.exec(md);
    expect(titleMatch).toBeTruthy();
    if (titleMatch) {
      expect(titleMatch[1]).not.toContain('"');
      expect(titleMatch[1]).toContain("&quot;");
    }
  });
});

describe("PdfEmbed node — MD round-trip", () => {
  it("comment → node → comment (no page)", () => {
    const md =
      '<!-- episteme:pdf id="123" title="Transformers Survey" -->\n';
    const doc = mdToProseMirror(md);
    const back = proseMirrorToMd(doc);
    expect(back).toContain('<!-- episteme:pdf id="123" title="Transformers Survey" -->');
  });

  it("comment → node → comment (with page)", () => {
    const md =
      '<!-- episteme:pdf id="abc-456" title="Another Paper" page="3" -->\n';
    const doc = mdToProseMirror(md);
    const back = proseMirrorToMd(doc);
    expect(back).toContain('id="abc-456"');
    expect(back).toContain('title="Another Paper"');
    expect(back).toContain('page="3"');
  });

  it("pdfEmbed node is present in the parsed doc", () => {
    const md =
      '<!-- episteme:pdf id="123" title="Transformers Survey" -->\n';
    const doc = mdToProseMirror(md);
    const node = doc.content?.find((n: JSONContent) => n.type === "pdfEmbed");
    expect(node).toBeTruthy();
    expect(node?.attrs?.pdfId).toBe("123");
    expect(node?.attrs?.title).toBe("Transformers Survey");
  });
});

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("/p/[paperId] PDF preview", () => {
  it("does not auto-embed Chrome's native PDF viewer", async () => {
    const source = await readFile(path.join(__dirname, "page.tsx"), "utf8");

    expect(source).not.toContain("<iframe");
    expect(source).not.toContain('src={`/api/papers/${paper.id}/file`}');
    expect(source).not.toContain('@episteme/reader');
    expect(source).toContain("<PaperPdfPreview");
  });

  it("loads the PDF.js preview behind a client boundary", async () => {
    const source = await readFile(path.join(__dirname, "PaperPdfPreview.tsx"), "utf8");

    expect(source).toContain('"use client"');
    expect(source).toContain("ssr: false");
    expect(source).toContain('import("@episteme/reader")');
  });
});

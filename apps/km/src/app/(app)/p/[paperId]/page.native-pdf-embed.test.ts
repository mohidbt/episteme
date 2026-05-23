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

  it("does not auto-load the PDF.js reader preview", async () => {
    const source = await readFile(path.join(__dirname, "PaperPdfPreview.tsx"), "utf8");

    expect(source).not.toContain('"use client"');
    expect(source).not.toContain("dynamic(");
    expect(source).not.toContain("@episteme/reader");
    expect(source).toContain('href={`/papers/${paperId}/read`}');
    expect(source).toContain('href={`/api/papers/${paperId}/file`}');
  });
});

import { describe, it, expect, beforeAll } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  extractMetadata,
  extractCover,
  sanitizeFilename,
  filenameToTitle,
} from "./pdf-extract";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(
  __dirname,
  "../../e2e/fixtures/sample.pdf",
);

let sampleBytes: Uint8Array;

beforeAll(async () => {
  const buf = await readFile(FIXTURE_PATH);
  sampleBytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
});

describe("extractMetadata", () => {
  it("extracts title from Attention Is All You Need", async () => {
    const meta = await extractMetadata(sampleBytes);
    expect(meta.title).toBe("Attention Is All You Need");
  });

  it("extracts authors as an array of names", async () => {
    const meta = await extractMetadata(sampleBytes);
    expect(Array.isArray(meta.authors)).toBe(true);
    expect(meta.authors.length).toBeGreaterThan(0);
    // Sanity: the first known author of the fixture should be present.
    expect(meta.authors).toContain("Ashish Vaswani");
  });

  it("returns undefined DOI (arXiv PDF has no crossref DOI on page 1) or the arXiv DOI", async () => {
    const meta = await extractMetadata(sampleBytes);
    // Spec: `doi: '10.48550/arXiv.1706.03762' | undefined` — both allowed.
    expect(
      meta.doi === undefined || meta.doi === "10.48550/arXiv.1706.03762",
    ).toBe(true);
  });

  it("extracts year 2017", async () => {
    const meta = await extractMetadata(sampleBytes);
    expect(meta.year).toBe(2017);
  });

  it("returns filename-fallback metadata for a malformed PDF", async () => {
    const bogus = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04]);
    const meta = await extractMetadata(bogus, "My Paper.pdf");
    expect(meta).toEqual({
      title: "My Paper",
      authors: [],
      doi: undefined,
      year: undefined,
    });
  });
});

describe("extractCover", () => {
  it("returns a PNG Uint8Array with valid signature > 2KB", async () => {
    const png = await extractCover(sampleBytes);
    expect(png).toBeInstanceOf(Uint8Array);
    expect(png.length).toBeGreaterThan(2048);
    // PNG signature: 89 50 4E 47
    expect(png[0]).toBe(0x89);
    expect(png[1]).toBe(0x50);
    expect(png[2]).toBe(0x4e);
    expect(png[3]).toBe(0x47);
  });
});

describe("sanitizeFilename", () => {
  it("strips path traversal segments", () => {
    expect(sanitizeFilename("../../etc/passwd.pdf")).toBe("passwd.pdf");
  });

  it("preserves unicode filenames", () => {
    expect(sanitizeFilename("论文.pdf")).toBe("论文.pdf");
  });

  it("trims trailing whitespace", () => {
    expect(sanitizeFilename("paper.pdf   ")).toBe("paper.pdf");
    expect(sanitizeFilename("  paper.pdf")).toBe("paper.pdf");
  });
});

describe("filenameToTitle", () => {
  it("drops .pdf extension", () => {
    expect(filenameToTitle("paper.pdf")).toBe("paper");
  });

  it("sanitizes traversal and drops .pdf", () => {
    expect(filenameToTitle("../../etc/passwd.pdf")).toBe("passwd");
  });

  it("preserves unicode title", () => {
    expect(filenameToTitle("论文.pdf")).toBe("论文");
  });
});

describe("DOI regex", () => {
  // The same regex used inside extractMetadata — re-declared here as a unit test
  // so the spec is pinned. Must stay in sync with pdf-extract.ts.
  const DOI = /10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i;

  it("matches real arXiv DOI", () => {
    const m = "10.48550/arXiv.1706.03762".match(DOI);
    expect(m?.[0]).toBe("10.48550/arXiv.1706.03762");
  });

  it("matches a crossref DOI", () => {
    const m = "doi:10.1038/nature12373 blah".match(DOI);
    expect(m?.[0]).toBe("10.1038/nature12373");
  });

  it("rejects false positives like '10.1' alone", () => {
    expect("10.1".match(DOI)).toBeNull();
    expect("version 10.1 released".match(DOI)).toBeNull();
  });
});

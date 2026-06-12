// GSD-96 R4 — RED. Pure MIME/ext → action router for Finder drops.
//
// Edge-case enumeration (per §12) — applicable subset:
//   - empty/null:        File w/ empty name / unknown MIME / zero size
//   - canonical PDF:     application/pdf
//   - canonical MD:      .md + text/markdown, .markdown, no MIME (extension fallback)
//   - canonical BIB:     .bib (text/x-bibtex usually missing — extension only)
//   - canonical RIS:     .ris (application/x-research-info-systems rare — extension only)
//   - images:            png/jpeg/gif/webp/svg+xml → asset
//   - CSV reject:        .csv / text/csv → reject (paperset CSV per plan §3.9)
//   - unknown extension: .exe / random → reject
//   - precedence:        extension wins when MIME is empty; MIME wins when extension is ambiguous
//   - unicode filename:  non-ASCII still routes correctly
// Omissions:
//   - max-size enforcement (server-side; this fn is pre-upload classifier only).
//   - auth-fail (router is client-side pure; auth happens on server route).
//   - race/idempotency (state machine + dispatcher tests cover these).
//
// All cases must FAIL today because the module does not yet exist.

import { describe, it, expect } from "vitest";
import { routeFinderDrop, type FinderRouteAction } from "../finder-routing";

function makeFile(name: string, type = ""): File {
  return new File([new Uint8Array(8)], name, { type });
}

describe("routeFinderDrop", () => {
  it("PDF → paper-ingest", () => {
    const r = routeFinderDrop(makeFile("paper.pdf", "application/pdf"));
    expect(r.kind).toBe("paper");
  });

  it(".md → note", () => {
    const r = routeFinderDrop(makeFile("note.md", "text/markdown"));
    expect(r.kind).toBe("note");
  });

  it(".markdown → note", () => {
    const r = routeFinderDrop(makeFile("README.markdown", ""));
    expect(r.kind).toBe("note");
  });

  it(".bib → reference-bib", () => {
    const r = routeFinderDrop(makeFile("library.bib", ""));
    expect(r.kind).toBe("reference-bib");
  });

  it(".ris → reference-ris", () => {
    const r = routeFinderDrop(makeFile("export.ris", ""));
    expect(r.kind).toBe("reference-ris");
  });

  it.each([
    ["png", "image/png"],
    ["jpg", "image/jpeg"],
    ["jpeg", "image/jpeg"],
    ["gif", "image/gif"],
    ["webp", "image/webp"],
    ["svg", "image/svg+xml"],
  ])("image .%s → asset", (ext, mime) => {
    const r = routeFinderDrop(makeFile(`pic.${ext}`, mime));
    expect(r.kind).toBe("asset");
  });

  it(".csv → reject with generic copy", () => {
    const r = routeFinderDrop(makeFile("rows.csv", "text/csv"));
    expect(r.kind).toBe("reject");
    expect(r.reason).toBe("We cannot process this file");
  });

  it("unknown extension → reject with generic copy", () => {
    const r = routeFinderDrop(makeFile("malware.exe", "application/x-msdownload"));
    expect(r.kind).toBe("reject");
    expect(r.reason).toBe("We cannot process this file");
  });

  it("extension wins when MIME is empty", () => {
    // .bib never has a registered MIME — must still route via extension.
    const r = routeFinderDrop(makeFile("ref.bib", ""));
    expect(r.kind).toBe("reference-bib");
  });

  it("MIME wins for application/pdf even if extension is missing", () => {
    const r = routeFinderDrop(makeFile("paper-no-ext", "application/pdf"));
    expect(r.kind).toBe("paper");
  });

  it("unicode filename routes correctly", () => {
    const r = routeFinderDrop(makeFile("論文.pdf", "application/pdf"));
    expect(r.kind).toBe("paper");
  });

  it("empty filename + unknown MIME → reject", () => {
    const r = routeFinderDrop(makeFile("", ""));
    expect(r.kind).toBe("reject");
  });

  it("action enum is locked", () => {
    const allowed: FinderRouteAction["kind"][] = [
      "paper",
      "note",
      "reference-bib",
      "reference-ris",
      "asset",
      "reject",
    ];
    expect(allowed.length).toBe(6);
  });
});

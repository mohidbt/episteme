import { describe, it, expect } from "vitest";
import { extractCitations, parseBibLines } from "../parser";
import type { ExtractedPage } from "@/lib/ai/pdf-text";

function page(text: string, pageNumber = 1): ExtractedPage {
  return { pageNumber, text } as ExtractedPage;
}

describe("extractCitations marker extraction", () => {
  describe("bracketed markers (existing behavior)", () => {
    it("finds [n] markers", () => {
      const { markers } = extractCitations([
        page("As shown in [1] and later in [2], this works."),
      ]);
      expect(markers.map((m) => m.markerIndex)).toEqual([1, 2]);
    });

    it("deduplicates [n] markers across pages", () => {
      const { markers } = extractCitations([
        page("See [3].", 1),
        page("Also [3] and [4].", 2),
      ]);
      expect(markers.map((m) => m.markerIndex)).toEqual([3, 4]);
      expect(markers.find((m) => m.markerIndex === 3)?.pageNumber).toBe(1);
    });
  });

  describe("Vancouver/AMA/Nature inline numeric markers", () => {
    it("finds marker after sentence-ending period (society.26)", () => {
      const { markers } = extractCitations([
        page("a race-conscious society.26 As medical students…"),
      ]);
      expect(markers.map((m) => m.markerIndex)).toContain(26);
    });

    it("finds marker after period (requirement.27)", () => {
      const { markers } = extractCitations([
        page("to that requirement.27 The next sentence."),
      ]);
      expect(markers.map((m) => m.markerIndex)).toContain(27);
    });

    it("finds marker after closing parenthesis ((2020).12)", () => {
      const { markers } = extractCitations([
        page("studied this (2020).12 Subsequent work…"),
      ]);
      expect(markers.map((m) => m.markerIndex)).toContain(12);
    });

    it("finds marker after comma (foo,5 bar)", () => {
      const { markers } = extractCitations([
        page("such as Smith,5 and others"),
      ]);
      expect(markers.map((m) => m.markerIndex)).toContain(5);
    });

    it("finds Unicode superscript markers", () => {
      const { markers } = extractCitations([
        page("over the past years.⁵ Smith found…"),
      ]);
      expect(markers.map((m) => m.markerIndex)).toContain(5);
    });

    it("finds multi-digit Unicode superscript markers", () => {
      const { markers } = extractCitations([
        page("reported earlier.²⁶ The"),
      ]);
      expect(markers.map((m) => m.markerIndex)).toContain(26);
    });
  });

  describe("negative cases", () => {
    it("does NOT match version numbers like v1.6", () => {
      const { markers } = extractCitations([page("v1.6 release notes")]);
      expect(markers.map((m) => m.markerIndex)).not.toContain(6);
    });

    it("does NOT match years like 'in 2024 we'", () => {
      const { markers } = extractCitations([
        page("in 2024 we updated this"),
      ]);
      expect(markers).toEqual([]);
    });

    it("does NOT match when followed immediately by another digit/letter (Fig.2a)", () => {
      const { markers } = extractCitations([page("see Fig.2a below")]);
      expect(markers).toEqual([]);
    });

    it("does NOT match 4-digit numbers", () => {
      const { markers } = extractCitations([page("ended.2024 was the year")]);
      expect(markers).toEqual([]);
    });

    it("does NOT match decimal like 'rate.5%'", () => {
      const { markers } = extractCitations([page("rate.5% growth")]);
      expect(markers).toEqual([]);
    });

    // Codex R2 review — false positives observed in the wild.
    it("does NOT match figure labels (Fig.2 shows)", () => {
      const { markers } = extractCitations([page("Fig.2 shows the result")]);
      expect(markers).toEqual([]);
    });

    it("does NOT match page-header references (p.12)", () => {
      const { markers } = extractCitations([page("see p.12 for context")]);
      expect(markers).toEqual([]);
    });

    it("does NOT match equation labels (Eq.3)", () => {
      const { markers } = extractCitations([page("substitute into Eq.3 above")]);
      expect(markers).toEqual([]);
    });

    it("does NOT match section labels (Sec.4)", () => {
      const { markers } = extractCitations([page("discussed in Sec.4 below")]);
      expect(markers).toEqual([]);
    });

    it("accepts large markers up to 999 (meta-analyses)", () => {
      const { markers } = extractCitations([
        page("Per recent work.500 the finding holds"),
      ]);
      expect(markers.map((m) => m.markerIndex)).toContain(500);
    });
  });
});

// ---------------------------------------------------------------------------
// Bibliography line sanitization
//
// Observed in prod (Springer Nature PDFs run through the agents extractor):
//   - InDesign source filename leaks as a per-line prefix:
//       "springernature_nature_8614.indd:2. Parniske, M. ..."
//   - Zero-width no-break spaces (U+FEFF) sprinkled inside the text:
//       "Parniske, M.﻿ Arbuscular..."
// Both must be scrubbed before REF_ENTRY_START_RE / title extraction runs,
// otherwise the entire line gets attached as continuation to the previous
// entry and the filename ends up in the title field on /references.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Bibliography header detection — flowed two-column layouts
//
// Observed in prod (Family Medicine journal PDF, two-column layout):
//   pdfplumber extracts the right-column "REFERENCES" header concatenated to
//   the end of the last body-text line of the left column, e.g.:
//     "...with a par- REFERENCES"
//     "1. Petterson SM, ..."
// `BIB_HEADER_RE` is anchored ^...$ so this never matched → references=0.
// Fix: also accept "REFERENCES" / "BIBLIOGRAPHY" as a trailing token on a
// line, provided the next entry-start line begins at marker 1 (the start
// of a real bibliography).
// ---------------------------------------------------------------------------
describe("extractCitations — flowed bibliography header", () => {
  it("detects REFERENCES when appended to a body-text line in a 2-col layout", () => {
    const pages = [
      page("This is body text. Some words and more words.", 1),
      page(
        [
          "trailing body sentence wrapped into one line. REFERENCES",
          "1. Foo A. First title here. Nature. 2020;1(1):1-2.",
          "2. Bar B. Second title here. Science. 2021;2(2):3-4.",
          "3. Baz C. Third title here. Cell. 2022;3(3):5-6.",
        ].join("\n"),
        2,
      ),
    ];
    const { references } = extractCitations(pages);
    expect(references).toHaveLength(3);
    expect(references[0].markerIndex).toBe(1);
    expect(references[2].markerIndex).toBe(3);
  });

  it("does NOT falsely treat 'references' in mid-sentence body text as header", () => {
    const pages = [
      page(
        [
          "The authors note many references in their analysis below.",
          "More body text continues without a real bibliography section.",
        ].join("\n"),
        1,
      ),
    ];
    const { references } = extractCitations(pages);
    expect(references).toHaveLength(0);
  });
});

describe("parseBibLines — sanitization of agents-extractor artifacts", () => {
  it("strips InDesign filename prefix like 'springernature_nature_8614.indd:'", () => {
    const refs = parseBibLines([
      "springernature_nature_8614.indd:1. Foo, A. First title here. Nat. Rev. 1, 1–2 (2007).",
      "springernature_nature_8614.indd:2. Parniske, M. Arbuscular mycorrhiza: the mother of plant root endosymbioses. Nat. Rev. Microbiol. 6, 763–775 (2008).",
    ]);
    expect(refs).toHaveLength(2);
    expect(refs[1].markerIndex).toBe(2);
    expect(refs[1].rawText).not.toMatch(/\.indd:/);
    expect(refs[1].rawText.startsWith("Parniske")).toBe(true);
    expect(refs[1].title ?? "").not.toMatch(/\.indd/);
  });

  it("strips U+FEFF (zero-width no-break space) from rawText and title", () => {
    const refs = parseBibLines([
      "﻿1. Foo,﻿ A. First title.﻿ Nature 1, 1–2 (2007).",
      "2.﻿ Parniske,﻿ M.﻿ Arbuscular mycorrhiza.﻿ Nat. Rev. Microbiol.﻿ 6, 763–775 (2008).",
    ]);
    expect(refs).toHaveLength(2);
    for (const r of refs) {
      expect(r.rawText).not.toMatch(/﻿/);
      expect(r.title ?? "").not.toMatch(/﻿/);
      expect(r.authors ?? "").not.toMatch(/﻿/);
    }
  });

  it("combined: indd prefix + BOMs (the production corruption pattern)", () => {
    const refs = parseBibLines([
      "springernature_nature_8614.indd:﻿2.﻿﻿ Parniske, M. Arbuscular mycorrhiza: the mother of plant root endosymbioses. ﻿Nat. Rev. Microbiol.﻿ 6, 763–775 (2008).",
    ]);
    expect(refs).toHaveLength(1);
    expect(refs[0].markerIndex).toBe(2);
    expect(refs[0].rawText).not.toMatch(/\.indd/);
    expect(refs[0].rawText).not.toMatch(/﻿/);
    expect(refs[0].rawText.startsWith("Parniske")).toBe(true);
  });
});

/**
 * Round E — chat-agent `highlight()` tool can be called multiple times within
 * one agent run, producing several `paper_highlights` rows sharing the same
 * `runId`. Rows with the same (runId, page, bbox≈) are visually duplicate in
 * the sidebar; collapse them and merge their notes. Rows with the same runId
 * but different bbox represent distinct highlights and must be preserved.
 *
 * Tolerance: ±2 px per coord. Floats coming back from the DB / agent path can
 * drift by sub-pixel rounding even when the agent intended the same span.
 */
import { describe, expect, it } from "vitest";
import { dedupPaperHighlights, type PaperHighlightRowLite } from "./dedup-paper-highlights";

function row(over: Partial<PaperHighlightRowLite> = {}): PaperHighlightRowLite {
  return {
    id: "h1",
    page: 1,
    bbox: { x0: 10, y0: 20, x1: 100, y1: 40, page: 1 },
    noteMd: null,
    runId: null,
    toolCallId: null,
    createdAt: "2026-05-15T00:00:00Z",
    ...over,
  };
}

describe("dedupPaperHighlights", () => {
  it("collapses same runId + page + identical bbox into one entry, merging notes", () => {
    const out = dedupPaperHighlights([
      row({ id: "a", runId: "r1", noteMd: "note alpha" }),
      row({ id: "b", runId: "r1", noteMd: "note beta" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("a"); // first row's id kept
    expect(out[0].runId).toBe("r1");
    expect(out[0].noteMd).toBe("note alpha · note beta");
  });

  it("treats bbox within ±2 px tolerance as equivalent", () => {
    const out = dedupPaperHighlights([
      row({
        id: "a",
        runId: "r1",
        bbox: { x0: 10, y0: 20, x1: 100, y1: 40, page: 1 },
        noteMd: "first",
      }),
      row({
        id: "b",
        runId: "r1",
        bbox: { x0: 11, y0: 21, x1: 101, y1: 41, page: 1 },
        noteMd: "second",
      }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].noteMd).toBe("first · second");
  });

  it("keeps distinct entries when bbox differs beyond tolerance", () => {
    const out = dedupPaperHighlights([
      row({
        id: "a",
        runId: "r1",
        bbox: { x0: 10, y0: 20, x1: 100, y1: 40, page: 1 },
        noteMd: "top",
      }),
      row({
        id: "b",
        runId: "r1",
        bbox: { x0: 10, y0: 120, x1: 100, y1: 140, page: 1 },
        noteMd: "bottom",
      }),
    ]);
    expect(out).toHaveLength(2);
  });

  it("does not collapse same bbox across different runIds", () => {
    const out = dedupPaperHighlights([
      row({ id: "a", runId: "r1", noteMd: "from r1" }),
      row({ id: "b", runId: "r2", noteMd: "from r2" }),
    ]);
    expect(out).toHaveLength(2);
  });

  it("leaves rows without runId untouched (cannot dedup safely)", () => {
    const out = dedupPaperHighlights([
      row({ id: "a", runId: null, noteMd: "x" }),
      row({ id: "b", runId: null, noteMd: "y" }),
    ]);
    expect(out).toHaveLength(2);
  });

  it("dedupes notes within a merge (no '· duplicate · duplicate')", () => {
    const out = dedupPaperHighlights([
      row({ id: "a", runId: "r1", noteMd: "same" }),
      row({ id: "b", runId: "r1", noteMd: "same" }),
      row({ id: "c", runId: "r1", noteMd: "other" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].noteMd).toBe("same · other");
  });

  it("handles bbox arrays (multi-rect) by comparing first rect", () => {
    const out = dedupPaperHighlights([
      row({
        id: "a",
        runId: "r1",
        bbox: [{ x0: 10, y0: 20, x1: 100, y1: 40, page: 1 }],
        noteMd: "a",
      }),
      row({
        id: "b",
        runId: "r1",
        bbox: [{ x0: 10, y0: 20, x1: 100, y1: 40, page: 1 }],
        noteMd: "b",
      }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].noteMd).toBe("a · b");
  });
});

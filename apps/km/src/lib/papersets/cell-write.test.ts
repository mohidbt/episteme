import { describe, expect, it } from "vitest";
import { applyCellWrite, parseCsvCells, regenerateCsv } from "./cell-write";

const COLS = [
  { name: "n_subjects", description: "Subject count from Methods" },
  { name: "study_type", description: "RCT / observational / meta" },
];
const REFS = [{ paper_id: "p-1" }, { paper_id: "p-2" }];

function basePaperset(overrides: Partial<{ content: string; cellGrounding: Record<string, Record<string, { paper_id: string; block_ids: string[] }>> }> = {}) {
  return {
    columns: COLS,
    rowRefs: REFS,
    content: overrides.content ?? "",
    cellGrounding: overrides.cellGrounding ?? {},
  };
}

describe("regenerateCsv", () => {
  it("emits header + one row per ref with empty cells when content empty", () => {
    const out = regenerateCsv(REFS, COLS, {});
    expect(out.split("\n")).toEqual([
      "Reference,n_subjects,study_type",
      "p-1,,",
      "p-2,,",
    ]);
  });
});

describe("parseCsvCells", () => {
  it("returns dict {row:col => value} skipping header row and Reference column", () => {
    const csv = "Reference,n_subjects,study_type\np-1,42,RCT\np-2,100,observational";
    const cells = parseCsvCells(csv, COLS);
    expect(cells).toEqual({
      "0:n_subjects": "42",
      "0:study_type": "RCT",
      "1:n_subjects": "100",
      "1:study_type": "observational",
    });
  });

  it("returns empty dict on empty content", () => {
    expect(parseCsvCells("", COLS)).toEqual({});
  });

  it("handles quoted commas", () => {
    const csv = `Reference,n_subjects,study_type\np-1,"1,234",RCT`;
    const cells = parseCsvCells(csv, COLS);
    expect(cells["0:n_subjects"]).toBe("1,234");
  });
});

describe("applyCellWrite", () => {
  const grounding = { paper_id: "p-1", block_ids: ["p-1:7"] };

  it("writes a cell into empty content and returns regenerated CSV + grounding", () => {
    const ps = basePaperset();
    const out = applyCellWrite(ps, { row: 0, col: "n_subjects", value: "42", grounding });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.content).toContain("p-1,42,");
    expect(out.cellGrounding).toEqual({ "0": { n_subjects: grounding } });
  });

  it("idempotent retry: same value on filled cell succeeds", () => {
    const ps = basePaperset({
      content: "Reference,n_subjects,study_type\np-1,42,\np-2,,",
      cellGrounding: { "0": { n_subjects: grounding } },
    });
    const out = applyCellWrite(ps, { row: 0, col: "n_subjects", value: "42", grounding });
    expect(out.ok).toBe(true);
  });

  it("rejects overwrite of filled cell with DIFFERENT value", () => {
    const ps = basePaperset({
      content: "Reference,n_subjects,study_type\np-1,42,\np-2,,",
      cellGrounding: { "0": { n_subjects: grounding } },
    });
    const out = applyCellWrite(ps, { row: 0, col: "n_subjects", value: "99", grounding });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toBe("cell_filled");
  });

  it("rejects empty grounding.block_ids for non-n/a value", () => {
    const ps = basePaperset();
    const out = applyCellWrite(ps, {
      row: 0,
      col: "n_subjects",
      value: "42",
      grounding: { paper_id: "p-1", block_ids: [] },
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toBe("grounding_required");
  });

  it("allows empty grounding.block_ids for n/a value", () => {
    const ps = basePaperset();
    const out = applyCellWrite(ps, {
      row: 0,
      col: "n_subjects",
      value: "n/a",
      grounding: { paper_id: "p-1", block_ids: [] },
    });
    expect(out.ok).toBe(true);
  });

  it("rejects out-of-range row", () => {
    const ps = basePaperset();
    const out = applyCellWrite(ps, { row: 5, col: "n_subjects", value: "42", grounding });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toBe("row_oob");
  });

  it("rejects unknown column", () => {
    const ps = basePaperset();
    const out = applyCellWrite(ps, { row: 0, col: "nope", value: "42", grounding });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toBe("unknown_col");
  });
});

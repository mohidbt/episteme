import { describe, it, expect } from "vitest";
import { deriveCellState, cellKey, buildFilledKeys } from "./grid-helpers";

describe("cellKey", () => {
  it("joins row and col with colon", () => {
    expect(cellKey(0, "x")).toBe("0:x");
    expect(cellKey(3, "assay_type")).toBe("3:assay_type");
  });
});

describe("buildFilledKeys", () => {
  it("returns set of keys from cellValues map", () => {
    const m = new Map([
      ["0:x", "val1"],
      ["1:y", "val2"],
    ]);
    const result = buildFilledKeys(m);
    expect(result).toEqual(new Set(["0:x", "1:y"]));
  });
});

describe("deriveCellState", () => {
  const baseOpts = {
    runningKeys: new Set<string>(),
    failedKeys: new Map<string, string>(),
    cellValues: new Map<string, string>(),
    grounding: {} as Record<
      string,
      Record<string, { paper_id: string; block_ids: string[] }>
    >,
  };

  it("returns empty when cell has no value and is not running/failed", () => {
    expect(deriveCellState(0, "x", baseOpts)).toEqual({ kind: "empty" });
  });

  it("returns running when cell key is in runningKeys", () => {
    const opts = {
      ...baseOpts,
      runningKeys: new Set(["0:x"]),
    };
    expect(deriveCellState(0, "x", opts)).toEqual({ kind: "running" });
  });

  it("returns failed with message when cell key is in failedKeys", () => {
    const opts = {
      ...baseOpts,
      failedKeys: new Map([["0:x", "Network error"]]),
    };
    expect(deriveCellState(0, "x", opts)).toEqual({
      kind: "failed",
      message: "Network error",
    });
  });

  it("returns filled with value and firstPage from grounding", () => {
    const opts = {
      ...baseOpts,
      cellValues: new Map([["0:x", "some value"]]),
      grounding: {
        "0": {
          x: { paper_id: "p1", block_ids: ["block_abc_p5_0"] },
        },
      },
    };
    const state = deriveCellState(0, "x", opts);
    expect(state.kind).toBe("filled");
    if (state.kind === "filled") {
      expect(state.value).toBe("some value");
      expect(state.firstPage).toBe(5);
    }
  });

  it("returns filled with firstPage=null when block ID has no page anchor", () => {
    const opts = {
      ...baseOpts,
      cellValues: new Map([["0:x", "some value"]]),
      grounding: {
        "0": {
          x: { paper_id: "p1", block_ids: ["seg_ABC_nonpage"] },
        },
      },
    };
    const state = deriveCellState(0, "x", opts);
    expect(state.kind).toBe("filled");
    if (state.kind === "filled") {
      expect(state.firstPage).toBeNull();
    }
  });

  it("returns filled with firstPage=null when grounding is missing", () => {
    const opts = {
      ...baseOpts,
      cellValues: new Map([["0:x", "some value"]]),
      grounding: {},
    };
    const state = deriveCellState(0, "x", opts);
    expect(state.kind).toBe("filled");
    if (state.kind === "filled") {
      expect(state.firstPage).toBeNull();
    }
  });
});
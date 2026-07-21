import { describe, it, expect } from "vitest";
import { filterVisibleHighlights } from "../filter-visible-highlights";
import type { UserHighlight } from "../../components/UserHighlightLayer";

function h(partial: Partial<UserHighlight> & { id: UserHighlight["id"] }): UserHighlight {
  return {
    id: partial.id,
    color: partial.color ?? "amber",
    source: partial.source ?? "ai-auto",
    layerId: partial.layerId ?? null,
    rects: partial.rects ?? [{ page: 1, x0: 0, y0: 0, x1: 1, y1: 1 }],
  };
}

const USER = h({ id: 1, source: "user", layerId: null });
const AI_RUN_A = h({ id: "a1", source: "ai-auto", layerId: "run-A" });
const AI_RUN_A2 = h({ id: "a2", source: "ai-auto", layerId: "run-A" });
const AI_RUN_B = h({ id: "b1", source: "ai-auto", layerId: "run-B" });
const AI_MANUAL_NULL = h({ id: "m1", source: "ai-auto", layerId: null });

const ALL = [USER, AI_RUN_A, AI_RUN_A2, AI_RUN_B, AI_MANUAL_NULL];

describe("filterVisibleHighlights", () => {
  it("hides only the targeted run's AI highlights, keeping other runs and user", () => {
    const result = filterVisibleHighlights(ALL, {
      hiddenLayerIds: new Set(["run-A"]),
      hideAllUser: false,
    });
    expect(result).toEqual([USER, AI_RUN_B, AI_MANUAL_NULL]);
    expect(result).not.toContain(AI_RUN_A);
    expect(result).not.toContain(AI_RUN_A2);
  });

  it("hides all user-source highlights but keeps every AI highlight when hideAllUser=true", () => {
    const result = filterVisibleHighlights(ALL, {
      hiddenLayerIds: new Set(),
      hideAllUser: true,
    });
    expect(result).toEqual([AI_RUN_A, AI_RUN_A2, AI_RUN_B, AI_MANUAL_NULL]);
    expect(result).not.toContain(USER);
  });

  it("restores everything when the set is empty and hideAllUser=false", () => {
    const result = filterVisibleHighlights(ALL, {
      hiddenLayerIds: new Set(),
      hideAllUser: false,
    });
    expect(result).toEqual(ALL);
  });

  it("leaves null-layerId AI rows unaffected by a run-hide", () => {
    const result = filterVisibleHighlights(ALL, {
      hiddenLayerIds: new Set(["run-A", "run-B"]),
      hideAllUser: false,
    });
    expect(result).toContain(AI_MANUAL_NULL);
    expect(result).toContain(USER);
  });

  it("combines both filters: hidden run + hideAllUser", () => {
    const result = filterVisibleHighlights(ALL, {
      hiddenLayerIds: new Set(["run-B"]),
      hideAllUser: true,
    });
    expect(result).toEqual([AI_RUN_A, AI_RUN_A2, AI_MANUAL_NULL]);
  });

  it("does not mutate the source array", () => {
    const snapshot = [...ALL];
    filterVisibleHighlights(ALL, { hiddenLayerIds: new Set(["run-A"]), hideAllUser: true });
    expect(ALL).toEqual(snapshot);
  });
});

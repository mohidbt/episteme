import { describe, it, expect } from "vitest";
import { semanticEdges } from "../schema/semantic-edges";
import { referenceEmbeddings } from "../schema/reference-embeddings";
import { pendingRecompute } from "../schema/pending-recompute";

describe("kg schema", () => {
  it("semanticEdges columns present", () => {
    for (const c of ["userId", "srcKind", "srcId", "dstKind", "dstId", "weight", "computedAt"]) {
      expect(Object.keys(semanticEdges)).toContain(c);
    }
  });
  it("referenceEmbeddings vector + computedAt", () => {
    expect(Object.keys(referenceEmbeddings)).toEqual(
      expect.arrayContaining(["referenceId", "embedding", "computedAt"]),
    );
  });
  it("pendingRecompute claim cols + tries", () => {
    expect(Object.keys(pendingRecompute)).toEqual(
      expect.arrayContaining(["userId", "kind", "nodeId", "enqueuedAt", "claimedAt", "tries"]),
    );
  });
});

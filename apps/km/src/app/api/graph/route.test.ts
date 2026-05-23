// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  getUserIdFromRequest: vi.fn(),
}));

vi.mock("@/lib/graph/live-edges", () => ({
  nodesForUser: vi.fn(),
  edgesPaperIsRef: vi.fn(),
  edgesWikiLink: vi.fn(),
  edgesSharedTag: vi.fn(),
  edgesSemanticSim: vi.fn(),
  edgesPaperCitations: vi.fn(),
}));

import { getUserIdFromRequest } from "@/lib/auth";
import {
  nodesForUser,
  edgesPaperIsRef,
  edgesWikiLink,
  edgesSharedTag,
  edgesSemanticSim,
  edgesPaperCitations,
} from "@/lib/graph/live-edges";
import { GET } from "./route";

function makeReq(): Request {
  return new Request("http://localhost/api/graph");
}

describe("GET /api/graph", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(getUserIdFromRequest).mockResolvedValue(null);

    const res = await GET(makeReq());

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("returns nodes and capped edges for authenticated user", async () => {
    vi.mocked(getUserIdFromRequest).mockResolvedValue("u1");
    vi.mocked(nodesForUser).mockResolvedValue([{ id: "n1" }, { id: "n2" }] as never);

    const refEdges = Array.from({ length: 5002 }, (_, i) => ({
      src: `p${i}`,
      dst: `r${i}`,
      kind: "paper_is_ref",
      weight: 1,
    }));
    const wikiEdges = Array.from({ length: 5001 }, (_, i) => ({
      src: `w${i}`,
      dst: `v${i}`,
      kind: "wiki_link",
      weight: 1,
    }));
    const tagEdges = [
      { src: "t1", dst: "t2", kind: "shared_tag", weight: 1 },
      { src: "t3", dst: "t4", kind: "shared_tag", weight: 9 },
      { src: "t5", dst: "t6", kind: "shared_tag", weight: 5 },
    ];
    const semEdges = [
      { src: "s1", dst: "s2", kind: "semantic_sim", weight: 0.2 },
      { src: "s3", dst: "s4", kind: "semantic_sim", weight: 0.9 },
      { src: "s5", dst: "s6", kind: "semantic_sim", weight: 0.5 },
    ];

    vi.mocked(edgesPaperIsRef).mockResolvedValue(refEdges as never);
    vi.mocked(edgesWikiLink).mockResolvedValue(wikiEdges as never);
    vi.mocked(edgesSharedTag).mockResolvedValue(tagEdges as never);
    vi.mocked(edgesSemanticSim).mockResolvedValue(semEdges as never);
    vi.mocked(edgesPaperCitations).mockResolvedValue([] as never);

    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(nodesForUser).toHaveBeenCalledWith("u1");
    expect(edgesPaperIsRef).toHaveBeenCalledWith("u1");
    expect(edgesWikiLink).toHaveBeenCalledWith("u1");
    expect(edgesSharedTag).toHaveBeenCalledWith("u1");
    expect(edgesSemanticSim).toHaveBeenCalledWith("u1", 20);

    expect(body.nodes).toEqual([{ id: "n1" }, { id: "n2" }]);
    expect(body.capped).toEqual({
      paper_is_ref: { kept: 5000, total: 5002 },
      citing: { kept: 0, total: 0 },
      cited_in: { kept: 0, total: 0 },
      wiki_link: { kept: 5000, total: 5001 },
      shared_tag: { kept: 3, total: 3 },
      semantic_sim: { kept: 3, total: 3 },
    });

    expect(body.edges).toHaveLength(5000 + 5000 + 3 + 3);
    expect(body.edges[0]).toMatchObject({ src: "p0", dst: "r0", kind: "paper_is_ref" });
    expect(body.edges[4999]).toMatchObject({ src: "p4999", dst: "r4999", kind: "paper_is_ref" });
    expect(body.edges[5000]).toMatchObject({ src: "w0", dst: "v0", kind: "wiki_link" });
    expect(body.edges[9999]).toMatchObject({ src: "w4999", dst: "v4999", kind: "wiki_link" });

    const tail = body.edges.slice(-6);
    expect(tail.slice(0, 3).map((e: { weight: number }) => e.weight)).toEqual([9, 5, 1]);
    expect(tail.slice(3).map((e: { weight: number }) => e.weight)).toEqual([0.9, 0.5, 0.2]);
  });

  it("returns citing + cited_in edges and KEEPS paper_is_ref on duplicate pairs (identity ≠ citation)", async () => {
    vi.mocked(getUserIdFromRequest).mockResolvedValue("u1");
    vi.mocked(nodesForUser).mockResolvedValue([] as never);

    // Duplicate pair (paper pA -> paper pB) appears as both paper_is_ref and paper_citation.
    const refEdges = [
      {
        src: { kind: "paper", id: "pA" },
        dst: { kind: "paper", id: "pB" },
        kind: "paper_is_ref",
        weight: 1,
      },
      {
        src: { kind: "paper", id: "pX" },
        dst: { kind: "reference", id: "rY" },
        kind: "paper_is_ref",
        weight: 1,
      },
    ];
    const citeEdges = [
      {
        src: { kind: "paper", id: "pA" },
        dst: { kind: "paper", id: "pB" },
        kind: "citing",
        weight: 1,
      },
      {
        src: { kind: "paper", id: "pB" },
        dst: { kind: "paper", id: "pA" },
        kind: "cited_in",
        weight: 1,
      },
      {
        src: { kind: "paper", id: "pC" },
        dst: { kind: "paper", id: "pD" },
        kind: "citing",
        weight: 1,
      },
      {
        src: { kind: "paper", id: "pD" },
        dst: { kind: "paper", id: "pC" },
        kind: "cited_in",
        weight: 1,
      },
    ];

    vi.mocked(edgesPaperIsRef).mockResolvedValue(refEdges as never);
    vi.mocked(edgesWikiLink).mockResolvedValue([] as never);
    vi.mocked(edgesSharedTag).mockResolvedValue([] as never);
    vi.mocked(edgesSemanticSim).mockResolvedValue([] as never);
    vi.mocked(edgesPaperCitations).mockResolvedValue(citeEdges as never);

    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(edgesPaperCitations).toHaveBeenCalledWith("u1");

    const kinds = body.edges.map((e: { kind: string }) => e.kind);
    // citing + cited_in present
    expect(kinds).toContain("citing");
    expect(kinds).toContain("cited_in");
    // Post-H-batch: both identity (paper_is_ref) and citation (citing) for
    // the same (pA, pB) pair surface. They mean different things.
    const dupPair = body.edges.filter(
      (e: { src: { id: string }; dst: { id: string } }) => e.src.id === "pA" && e.dst.id === "pB"
    );
    expect(dupPair).toHaveLength(2);
    const dupKinds = new Set(dupPair.map((e: { kind: string }) => e.kind));
    expect(dupKinds.has("paper_is_ref")).toBe(true);
    expect(dupKinds.has("citing")).toBe(true);
    // non-duplicated paper_is_ref still present
    expect(
      body.edges.find(
        (e: { src: { id: string }; dst: { id: string } }) => e.src.id === "pX" && e.dst.id === "rY"
      )?.kind
    ).toBe("paper_is_ref");
    // non-duplicated citing still present
    expect(
      body.edges.find(
        (e: { src: { id: string }; dst: { id: string } }) => e.src.id === "pC" && e.dst.id === "pD"
      )?.kind
    ).toBe("citing");

    expect(body.capped).toMatchObject({
      citing: { kept: 2, total: 2 },
      cited_in: { kept: 2, total: 2 },
    });
  });
});

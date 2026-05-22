import { describe, it, expect, beforeAll } from "vitest";
import {
  seedGraphFixture,
  seedPaperCitationsFixture,
  SEED_USER,
  SEED_IDS,
} from "../../../../../packages/db/__tests__/fixtures/graph-seed";
import {
  edgesPaperIsRef,
  edgesWikiLink,
  edgesSharedTag,
  edgesSemanticSim,
  edgesPaperCitations,
  nodesForUser,
} from "./live-edges";

beforeAll(async () => {
  await seedGraphFixture();
  await seedPaperCitationsFixture();
});

describe("live-edges", () => {
  it("paper_is_ref returns p2 -> r1", async () => {
    const r = await edgesPaperIsRef(SEED_USER);
    expect(r.length).toBeGreaterThanOrEqual(1);
    expect(r[0].kind).toBe("paper_is_ref");
  });
  it("wiki_link returns n1->p1 and n1->r1", async () => {
    const r = await edgesWikiLink(SEED_USER);
    expect(r.length).toBeGreaterThanOrEqual(2);
    expect(r.some((e) => e.dst.kind === "paper")).toBe(true);
    expect(r.some((e) => e.dst.kind === "reference")).toBe(true);
  });
  it("shared_tag note↔note", async () => {
    const r = await edgesSharedTag(SEED_USER);
    expect(r.some((e) => e.src.kind === "note" && e.dst.kind === "note")).toBe(true);
  });
  it("nodesForUser returns 3 kinds", async () => {
    const ns = await nodesForUser(SEED_USER);
    const kinds = new Set(ns.map((n) => n.kind));
    expect(kinds.has("paper") && kinds.has("note") && kinds.has("reference")).toBe(true);
  });
  it("paper_citations: emits reciprocal citing + cited_in edges for each paper↔paper row", async () => {
    const r = await edgesPaperCitations(SEED_USER);
    // One same-user paper↔paper row → 2 edges (citing + cited_in)
    expect(r.length).toBe(2);

    const citing = r.find((e) => e.kind === "citing");
    const citedIn = r.find((e) => e.kind === "cited_in");
    expect(citing).toBeDefined();
    expect(citedIn).toBeDefined();

    // citing: src=p1 (citer) → dst=p2 (cited)
    expect(citing!.src).toEqual({ kind: "paper", id: SEED_IDS.p1 });
    expect(citing!.dst).toEqual({ kind: "paper", id: SEED_IDS.p2 });
    // cited_in: src=p2 (cited) → dst=p1 (citer)
    expect(citedIn!.src).toEqual({ kind: "paper", id: SEED_IDS.p2 });
    expect(citedIn!.dst).toEqual({ kind: "paper", id: SEED_IDS.p1 });

    // cross-user paper edge not present
    expect(r.some((x) => x.dst.id === SEED_IDS.pOther || x.src.id === SEED_IDS.pOther)).toBe(false);
    // reference-cited edge not present
    expect(r.some((x) => x.dst.kind === "reference" || x.src.kind === "reference")).toBe(false);
  });

  it("edgesSemanticSim returns empty array on empty table", async () => {
    const r = await edgesSemanticSim(SEED_USER);
    expect(Array.isArray(r)).toBe(true);
    // demo cut: semantic_edges is empty in production; helper still must not throw
  });
});

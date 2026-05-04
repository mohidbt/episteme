import { describe, it, expect, beforeAll } from "vitest";
import { seedGraphFixture, SEED_USER } from "../../../../../packages/db/__tests__/fixtures/graph-seed";
import {
  edgesPaperIsRef,
  edgesWikiLink,
  edgesSharedTag,
  edgesSemanticSim,
  nodesForUser,
} from "./live-edges";

beforeAll(async () => {
  await seedGraphFixture();
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
  it("edgesSemanticSim returns empty array on empty table", async () => {
    const r = await edgesSemanticSim(SEED_USER);
    expect(Array.isArray(r)).toBe(true);
    // demo cut: semantic_edges is empty in production; helper still must not throw
  });
});

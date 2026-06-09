// GSD-32 Phase 1 + B5: when a paper is deleted, the matched ref's paperId is
// SET NULL (existing FK behaviour) which makes the ref re-surface in
// listAllReferences (which filters on paperId IS NULL per Phase 1).
//
// This is a pure-unit test: it stubs the DB select to exercise the SQL
// WHERE clause shape. Integration coverage (real FK + cascade) runs in CI
// against Postgres.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => {
  return {
    db: {
      select: vi.fn(),
    },
  };
});

import { db } from "@/lib/db";
import { listAllReferences } from "@/lib/references-server";

beforeEach(() => {
  vi.resetAllMocks();
});

describe("listAllReferences — Phase 1 collapse filter", () => {
  it("WHERE clause filters out refs whose paperId is set", async () => {
    let capturedWhere: unknown = null;
    const chain: Record<string, unknown> = {
      from: () => chain,
      where: (clause: unknown) => {
        capturedWhere = clause;
        return chain;
      },
      orderBy: () => Promise.resolve([]),
    };
    vi.mocked(db.select).mockReturnValue(chain as never);

    await listAllReferences(1, "u-test");

    // Drizzle's `and(...)` returns an SQL builder whose queryChunks include
    // the column refs of each conjunct. Walk the chunks looking for the
    // `paper_id` column reference. Avoid full JSON.stringify because Drizzle
    // tables hold circular parent refs.
    function chunksContainColumn(node: unknown, col: string): boolean {
      if (!node || typeof node !== "object") return false;
      const visited = new WeakSet<object>();
      const stack: unknown[] = [node];
      while (stack.length > 0) {
        const cur = stack.pop();
        if (!cur || typeof cur !== "object") continue;
        if (visited.has(cur as object)) continue;
        visited.add(cur as object);
        const obj = cur as Record<string, unknown>;
        if (typeof obj.name === "string" && obj.name === col) return true;
        for (const k of Object.keys(obj)) {
          if (k === "table") continue;
          const v = obj[k];
          if (Array.isArray(v)) stack.push(...v);
          else if (v && typeof v === "object") stack.push(v);
        }
      }
      return false;
    }
    expect(chunksContainColumn(capturedWhere, "paper_id")).toBe(true);
  });
});

// GSD-77 regression coverage: wiki-link search refs branch must NEVER stop
// filtering paper-bound refs. Phase 1 of GSD-32 hides collapsed refs from
// the wiki-link picker so the paper alone surfaces.
//
// Pure-unit test: stubs the DB chain, captures the refs-query WHERE clause,
// asserts paper_id column is referenced.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({ db: { select: vi.fn() } }));
vi.mock("@/lib/auth", () => ({ getUserIdFromRequest: vi.fn(async () => "u-test") }));

import { db } from "@/lib/db";
import { GET } from "@/app/api/wiki-link/search/route";

beforeEach(() => {
  vi.resetAllMocks();
});

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

describe("wiki-link search — GSD-32 Phase 1 collapse filter", () => {
  it("refs branch WHERE clause includes paper_id IS NULL", async () => {
    // Order of selects in the route: 0 libraries, 1 notes, 2 references, 3 papers.
    const wheres: unknown[] = [];
    let idx = 0;
    const makeChain = (index: number) => {
      const chain: Record<string, unknown> = {
        from: () => chain,
        where: (clause: unknown) => {
          wheres[index] = clause;
          return chain;
        },
        orderBy: () => chain,
        limit: () => Promise.resolve(index === 0 ? [{ id: 1 }] : []),
      };
      return chain;
    };
    vi.mocked(db.select).mockImplementation(() => {
      const c = makeChain(idx);
      idx += 1;
      return c as never;
    });

    const req = new Request("http://localhost/api/wiki-link/search?q=foo");
    await GET(req);

    const refsWhere = wheres[2];
    expect(chunksContainColumn(refsWhere, "paper_id")).toBe(true);
  });
});

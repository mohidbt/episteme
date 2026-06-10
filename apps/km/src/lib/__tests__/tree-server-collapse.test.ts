// GSD-77 regression coverage: getTreeForUser must NEVER stop filtering
// references whose paperId is non-null. Phase 1 of GSD-32 hides collapsed
// (paper-bound) refs from the drive sidebar tree. This test exercises the
// WHERE clause shape directly so a future removal of the filter is caught
// before reaching production.
//
// Pure-unit test: stubs all DB chains so we can capture the refs-query WHERE
// argument and assert it references the `paper_id` column.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => {
  return {
    db: {
      select: vi.fn(),
    },
  };
});

vi.mock("react", async (orig) => {
  // `cache` from react wraps the function; for the test we pass through.
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, cache: <T>(fn: T) => fn };
});

import { db } from "@/lib/db";
import { getTreeForUser } from "@/lib/tree-server";

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

describe("getTreeForUser — GSD-32 Phase 1 collapse filter", () => {
  it("refs query WHERE clause filters paper_id IS NULL", async () => {
    // Capture the WHERE clause from the refs query (3rd .from() call).
    const wheres: unknown[] = [];
    let chainCount = 0;
    const makeChain = (index: number) => {
      const chain: Record<string, unknown> = {
        from: () => chain,
        where: (clause: unknown) => {
          wheres[index] = clause;
          return chain;
        },
        limit: () => Promise.resolve(index === 0 ? [{ id: 1, name: "Lib" }] : []),
        orderBy: () => Promise.resolve([]),
      };
      return chain;
    };
    vi.mocked(db.select).mockImplementation(() => {
      const c = makeChain(chainCount);
      chainCount += 1;
      return c as never;
    });

    await getTreeForUser(1, "u-test");

    // Order of selects in getTreeForUser:
    //   0: libRows (libraries)
    //   1: folders
    //   2: papers
    //   3: refs        <-- the one we care about
    //   4: notes
    //   5: papersets
    const refsWhere = wheres[3];
    expect(chunksContainColumn(refsWhere, "paper_id")).toBe(true);
  });
});

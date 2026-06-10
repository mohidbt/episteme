// GSD-77 regression coverage: nodesForUser must NEVER stop filtering
// paper-bound refs. Phase 1 of GSD-32 hides collapsed refs from the graph.
//
// Pure-unit test: stubs db.execute, captures the SQL fragments, asserts the
// refs query mentions `paper_id IS NULL`.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@episteme/db/client", () => ({ db: { execute: vi.fn() } }));

import { db } from "@episteme/db/client";
import { nodesForUser } from "../live-edges";

beforeEach(() => {
  vi.resetAllMocks();
});

// Render a drizzle sql template by walking its queryChunks. Each chunk is
// either a static SQL fragment ({ value: [string] }) or a parameter (we
// just drop those — we only care about the static SQL shape).
function renderSql(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const obj = node as { queryChunks?: unknown[] };
  const chunks = obj.queryChunks ?? [];
  let out = "";
  for (const c of chunks) {
    if (c && typeof c === "object") {
      const cc = c as { value?: unknown };
      if (Array.isArray(cc.value)) {
        for (const v of cc.value) if (typeof v === "string") out += v;
      } else {
        // Nested sql / column refs — best-effort recurse.
        out += renderSql(c);
      }
    }
  }
  return out;
}

describe("nodesForUser — GSD-32 Phase 1 collapse filter", () => {
  it("refs query SQL contains paper_id IS NULL", async () => {
    const captured: string[] = [];
    vi.mocked(db.execute).mockImplementation(async (q: unknown) => {
      captured.push(renderSql(q));
      return { rows: [] } as never;
    });

    await nodesForUser("u-test");

    // Find the refs query among the three execute() calls (papers, notes, refs).
    const refsSql = captured.find((s) => s.includes('"references"'));
    expect(refsSql).toBeDefined();
    expect(refsSql!.replace(/\s+/g, " ")).toMatch(/paper_id IS NULL/i);
  });
});

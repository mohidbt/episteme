import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@episteme/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));
vi.mock("@/lib/db", () => ({
  db: { select: vi.fn(), transaction: vi.fn() },
}));

import { auth } from "@episteme/auth/server";
import { db } from "@/lib/db";
import { DELETE } from "./route";

const PAPER_ID = "00000000-0000-0000-0000-000000000001";
const RUN_ID = "11111111-1111-1111-1111-111111111111";
const buildReq = () =>
  new Request(`http://x/api/papers/${PAPER_ID}/auto-highlight/runs/${RUN_ID}`, {
    method: "DELETE",
  }) as unknown as import("next/server").NextRequest;
const routeParams = { params: Promise.resolve({ id: PAPER_ID, runId: RUN_ID }) };

beforeEach(() => vi.resetAllMocks());

describe("DELETE /api/papers/[id]/auto-highlight/runs/[runId]", () => {
  it("401 when unauthenticated", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    const res = await DELETE(buildReq(), routeParams);
    expect(res.status).toBe(401);
  });

  it("400 on invalid runId", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1" } } as never);
    const badParams = {
      params: Promise.resolve({ id: PAPER_ID, runId: "not-a-uuid" }),
    };
    const res = await DELETE(buildReq(), badParams);
    expect(res.status).toBe(400);
  });

  it("404 when paper missing", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1" } } as never);
    vi.mocked(db.select).mockReturnValueOnce({
      from: () => ({ where: () => ({ limit: async () => [] }) }),
    } as never);
    const res = await DELETE(buildReq(), routeParams);
    expect(res.status).toBe(404);
  });

  it("404 when run found by paperId but no rows match across all three tables", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1" } } as never);
    // Paper ownership check passes.
    vi.mocked(db.select).mockReturnValueOnce({
      from: () => ({
        where: () => ({ limit: async () => [{ id: PAPER_ID, userId: "u1" }] }),
      }),
    } as never);
    (vi.mocked(db.transaction) as unknown as { mockImplementationOnce: (fn: unknown) => void }).mockImplementationOnce(async (cb: unknown) => {
      const tx = {
        delete: () => ({ where: () => ({ returning: async () => [] }) }),
      };
      return (cb as (t: typeof tx) => Promise<number>)(tx);
    });
    const res = await DELETE(buildReq(), routeParams);
    expect(res.status).toBe(404);
  });

  it("cascades across user_highlights + paper_highlights + ai_highlight_runs, scoping each by paperId", async () => {
    const { userHighlights, paperHighlights, aiHighlightRuns } = await import(
      "@episteme/db/schema"
    );

    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1" } } as never);
    vi.mocked(db.select).mockReturnValueOnce({
      from: () => ({
        where: () => ({ limit: async () => [{ id: PAPER_ID, userId: "u1" }] }),
      }),
    } as never);

    // Capture each tx.delete() target + its `and(...)` where-clause. Drizzle
    // `and(...)` returns an SQL object whose `queryChunks` array references
    // the columns being filtered on; we walk it to assert paperId is one
    // of those columns for each delete (codex review fix #2 — without the
    // paperId filter on user_highlights, a same-user runId collision across
    // papers could delete the wrong paper's highlights).
    const calls: { table: unknown; clause: unknown }[] = [];
    (vi.mocked(db.transaction) as unknown as { mockImplementationOnce: (fn: unknown) => void }).mockImplementationOnce(async (cb: unknown) => {
      const tx = {
        delete: (table: unknown) => ({
          where: (clause: unknown) => ({
            returning: async () => {
              calls.push({ table, clause });
              return [{ id: "x" }];
            },
          }),
        }),
      };
      return (cb as (t: typeof tx) => Promise<number>)(tx);
    });

    const res = await DELETE(buildReq(), routeParams);
    expect(res.status).toBe(200);

    expect(calls.map((c) => c.table)).toEqual([
      userHighlights,
      paperHighlights,
      aiHighlightRuns,
    ]);

    const referencesPaperIdColumn = (clause: unknown, table: { paperId: unknown }): boolean => {
      const seen = new WeakSet<object>();
      const stack: unknown[] = [clause];
      while (stack.length) {
        const node = stack.pop();
        if (node === table.paperId) return true;
        if (node && typeof node === "object") {
          if (seen.has(node as object)) continue;
          seen.add(node as object);
          for (const v of Object.values(node as Record<string, unknown>)) {
            if (Array.isArray(v)) {
              for (const item of v) stack.push(item);
            } else if (v && typeof v === "object") {
              stack.push(v);
            }
          }
        }
      }
      return false;
    };
    expect(referencesPaperIdColumn(calls[0].clause, userHighlights)).toBe(true);
    expect(referencesPaperIdColumn(calls[1].clause, paperHighlights)).toBe(true);
    expect(referencesPaperIdColumn(calls[2].clause, { paperId: aiHighlightRuns.paperId })).toBe(true);
  });
});

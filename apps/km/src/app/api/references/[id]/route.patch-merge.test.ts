// GSD-72: route-level tests for PATCH /api/references/[id]'s reactive
// ref→paper metadata merge. We mock @/lib/db and the auth/folder/citation
// helpers because the surrounding logic is tested elsewhere — this file only
// asserts the merge call-site behavior.

import { describe, it, expect, vi, beforeEach } from "vitest";

const refRow = {
  id: "ref-1",
  libraryId: 1,
  userId: "u-1",
  paperId: "paper-1",
  cslJson: { title: "Old Title" },
};

const updateCalls: Array<{ table: string; values: Record<string, unknown> }> = [];

vi.mock("@/lib/db", () => {
  // Build a chainable mock that records which table .update() was called on.
  function makeUpdate(table: string) {
    let captured: Record<string, unknown> = {};
    const chain: Record<string, unknown> = {
      set: (values: Record<string, unknown>) => {
        captured = values;
        updateCalls.push({ table, values });
        return chain;
      },
      where: () => chain,
      returning: () => Promise.resolve([{ ...refRow, ...captured }]),
    };
    return chain;
  }
  return {
    db: {
      update: vi.fn((tableRef: unknown) => {
        const name = (tableRef as { _name?: string })?._name ?? "unknown";
        return makeUpdate(name);
      }),
      select: vi.fn(() => ({
        from: () => ({
          where: () => Promise.resolve([refRow]),
        }),
      })),
    },
  };
});

vi.mock("@episteme/db/schema", () => ({
  references_: { _name: "references" },
  papers: { _name: "papers" },
  noteLinks: { _name: "note_links" },
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ _and: args }),
  eq: (...args: unknown[]) => ({ _eq: args }),
}));

vi.mock("@/lib/internal-auth", () => ({
  getAuthedUserId: vi.fn().mockResolvedValue({ userId: "u-1" }),
  MissingInternalSecretError: class extends Error {},
}));

vi.mock("@/lib/auth/require-non-guest", () => ({
  requireNonGuestAuthed: vi.fn().mockResolvedValue({ ok: true, userId: "u-1" }),
}));

vi.mock("@/lib/crud", () => ({
  jsonError: (status: number, error: string, extra?: Record<string, unknown>) =>
    new Response(JSON.stringify({ error, ...(extra ?? {}) }), { status }),
  requireOwned: vi.fn(() => Promise.resolve({ ok: true, row: refRow })),
}));

vi.mock("@/lib/folders-server", () => ({
  getTrashFolderId: vi.fn(),
  moveItemToFolder: vi.fn(),
}));

vi.mock("@/lib/references", () => ({
  isUniqueViolation: () => false,
  suggestNextCitationKey: (k: string) => `${k}-1`,
}));

vi.mock("@/lib/citations/match-ref-to-papers", () => ({
  autoConnectReference: vi.fn().mockResolvedValue(undefined),
  extractRefSignals: vi.fn().mockReturnValue({}),
}));

import { PATCH } from "./route";
import { requireOwned } from "@/lib/crud";
import { db } from "@/lib/db";

function buildReq(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/references/ref-1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const ctx = { params: Promise.resolve({ id: "ref-1" }) };

beforeEach(() => {
  updateCalls.length = 0;
  refRow.paperId = "paper-1";
  refRow.cslJson = { title: "Old Title" };
});

describe("PATCH /api/references/:id — paper metadata merge (GSD-72)", () => {
  it("writes changed CSL title to bound paper row in same handler", async () => {
    const res = await PATCH(
      buildReq({ cslJson: { title: "New Title" } }),
      ctx,
    );
    expect(res.status).toBe(200);

    const paperUpdates = updateCalls.filter((c) => c.table === "papers");
    expect(paperUpdates.length).toBe(1);
    expect(paperUpdates[0].values).toEqual({ title: "New Title" });
  });

  it("skips paper write entirely when ref.paper_id is NULL", async () => {
    refRow.paperId = null as unknown as string;
    vi.mocked(requireOwned).mockResolvedValueOnce({ ok: true, row: refRow } as never);

    const res = await PATCH(
      buildReq({ cslJson: { title: "New Title" } }),
      ctx,
    );
    expect(res.status).toBe(200);

    const paperUpdates = updateCalls.filter((c) => c.table === "papers");
    expect(paperUpdates.length).toBe(0);
  });

  it("does not touch paper when year is malformed (per-field skip)", async () => {
    const res = await PATCH(
      buildReq({
        cslJson: { issued: { "date-parts": [["twenty-twenty"]] } },
      }),
      ctx,
    );
    expect(res.status).toBe(200);

    const paperUpdates = updateCalls.filter((c) => c.table === "papers");
    // Patch ends up empty -> no UPDATE on papers.
    expect(paperUpdates.length).toBe(0);
  });

  it("does not fail ref PATCH when paper write throws (silent best-effort)", async () => {
    // Make the papers UPDATE throw.
    const original = vi.mocked(db.update).getMockImplementation();
    vi.mocked(db.update).mockImplementation((tableRef: unknown) => {
      if ((tableRef as { _name?: string })?._name === "papers") {
        return {
          set: () => ({ where: () => Promise.reject(new Error("db down")) }),
        } as never;
      }
      return original!(tableRef as never);
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const res = await PATCH(
      buildReq({ cslJson: { title: "New Title" } }),
      ctx,
    );
    expect(res.status).toBe(200);
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it("no paper write when cslJson is not in the PATCH body", async () => {
    const res = await PATCH(buildReq({ citationKey: "newkey" }), ctx);
    expect(res.status).toBe(200);

    const paperUpdates = updateCalls.filter((c) => c.table === "papers");
    expect(paperUpdates.length).toBe(0);
  });
});

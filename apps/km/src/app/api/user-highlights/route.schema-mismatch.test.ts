import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const selectOrderBy = vi.fn();
  const selectWhere = vi.fn(() => ({ orderBy: selectOrderBy }));
  const selectFrom = vi.fn(() => ({ where: selectWhere }));
  const insertReturning = vi.fn();
  const insertValues = vi.fn(() => ({ returning: insertReturning }));
  const insert = vi.fn(() => ({ values: insertValues }));
  const deleteWhere = vi.fn();
  const del = vi.fn(() => ({ where: deleteWhere }));
  return {
    selectOrderBy,
    selectWhere,
    selectFrom,
    insertReturning,
    insertValues,
    insert,
    deleteWhere,
    del,
  };
});

vi.mock("@/lib/auth", () => ({
  getUserIdFromRequest: vi.fn(async () => "user-1"),
  // K9: requireNonGuestAuthed falls back to getSessionInfo for cookie callers.
  // The HMAC-mocked path below should short-circuit (viaHmac=true), but the
  // mock must still exist for the import to resolve.
  getSessionInfo: vi.fn(async () => ({ userId: "user-1", isAnonymous: false })),
}));

vi.mock("@episteme/auth/internal", () => ({
  // viaHmac=true so requireNonGuestAuthed short-circuits without hitting
  // getSessionInfo (matches what the schema-mismatch path exercises:
  // server-to-server HMAC calls from the agent).
  getAuthedUserId: vi.fn(async () => ({ userId: "user-1", viaHmac: true })),
  MissingInternalSecretError: class MissingInternalSecretError extends Error {},
}));

vi.mock("@/lib/crud", async () => {
  const actual = await vi.importActual<typeof import("@/lib/crud")>("@/lib/crud");
  return {
    ...actual,
    requireOwned: vi.fn(async () => ({ ok: true, row: { id: "paper-1", userId: "user-1" } })),
  };
});

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => ({ from: mocks.selectFrom })),
    insert: mocks.insert,
    delete: mocks.del,
  },
}));

import { DELETE, GET, POST } from "./route";

function req(path: string, init?: RequestInit): Request {
  return new Request(`http://localhost${path}`, init);
}

const missingPaperIdError = {
  code: "42703",
  message: 'column "paper_id" does not exist',
};

describe("user-highlights schema mismatch mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET maps missing paper_id drift to 503 schema_mismatch", async () => {
    mocks.selectOrderBy.mockRejectedValueOnce(missingPaperIdError);
    const res = await GET(req("/api/user-highlights?paperId=paper-1"));
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({ error: "schema_mismatch" });
  });

  it("POST maps missing paper_id drift to 503 schema_mismatch", async () => {
    mocks.insertReturning.mockRejectedValueOnce(missingPaperIdError);
    const res = await POST(
      req("/api/user-highlights", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-inhale-user-id": "user-1",
        },
        body: JSON.stringify({
          paperId: "11111111-1111-4111-8111-111111111111",
          pageNumber: 1,
          textContent: "hello",
          startOffset: 0,
          endOffset: 5,
        }),
      }),
    );
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({ error: "schema_mismatch" });
  });

  it("DELETE maps missing paper_id drift to 503 schema_mismatch", async () => {
    mocks.deleteWhere.mockRejectedValueOnce(missingPaperIdError);
    const res = await DELETE(req("/api/user-highlights?paperId=paper-1", { method: "DELETE" }));
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({ error: "schema_mismatch" });
  });

  it("does not over-catch non-drift errors", async () => {
    mocks.selectOrderBy.mockRejectedValueOnce(new Error("boom"));
    await expect(GET(req("/api/user-highlights?paperId=paper-1"))).rejects.toThrow("boom");
  });
});

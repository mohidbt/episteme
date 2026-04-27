/**
 * HMAC tests for POST /api/notes — focuses on the libraryId fallback added
 * for HMAC-authed agent calls (decision 2 in Task 0).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "crypto";

vi.mock("@/lib/db", () => ({
  db: { select: vi.fn(), insert: vi.fn() },
}));
vi.mock("@/lib/crud", async (orig) => {
  const real = await orig<typeof import("@/lib/crud")>();
  return {
    ...real,
    requireOwned: vi.fn(),
    resolveNoteSlug: vi.fn().mockResolvedValue("auto-slug"),
  };
});
vi.mock("@episteme/notes-core", () => ({
  resolveUnresolvedNoteLinks: vi.fn().mockResolvedValue(undefined),
  createRevisionIfNeeded: vi.fn().mockResolvedValue(undefined),
}));

import { db } from "@/lib/db";
import { requireOwned } from "@/lib/crud";
import { POST } from "./route";

const SECRET = "test-secret-abc";

function sign(ts: string, method: string, path: string, body: string): string {
  return createHmac("sha256", SECRET).update(ts + method + path + body).digest("hex");
}

function hmacReq(path: string, bodyObj: Record<string, unknown>): Request {
  const ts = String(Math.floor(Date.now() / 1000));
  const body = JSON.stringify(bodyObj);
  const sig = sign(ts, "POST", path, body);
  return new Request(`http://localhost:3001${path}`, {
    method: "POST",
    body,
    headers: {
      "X-Inhale-User-Id": "user-1",
      "X-Inhale-Ts": ts,
      "X-Inhale-Sig": sig,
      "content-type": "application/json",
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.INHALE_INTERNAL_SECRET = SECRET;
  // requireOwned succeeds by default for the libraries lookup
  vi.mocked(requireOwned).mockResolvedValue({ ok: true, row: { id: 7, userId: "user-1" } } as never);
  vi.mocked(db.insert).mockReturnValue({
    values: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ id: "note-1", title: "T", contentMd: "" }]),
    }),
  } as never);
});
afterEach(() => {
  delete process.env.INHALE_INTERNAL_SECRET;
});

function mockDefaultLibraryLookup(libRows: { id: number }[]) {
  vi.mocked(db.select).mockReturnValue({
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(libRows),
  } as never);
}

describe("POST /api/notes [HMAC]", () => {
  it("rejects no auth", async () => {
    const res = await POST(
      new Request("http://localhost/api/notes", {
        method: "POST",
        body: JSON.stringify({ title: "T" }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("rejects bad HMAC", async () => {
    const req = new Request("http://localhost/api/notes", {
      method: "POST",
      body: JSON.stringify({ title: "T" }),
      headers: {
        "X-Inhale-User-Id": "u",
        "X-Inhale-Ts": String(Math.floor(Date.now() / 1000)),
        "X-Inhale-Sig": "bad".repeat(20),
      },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("happy path: HMAC + body has libraryId", async () => {
    const req = hmacReq("/api/notes", {
      libraryId: 7,
      title: "Hello",
      contentMd: "world",
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
  });

  it("falls back to default library when libraryId is missing", async () => {
    mockDefaultLibraryLookup([{ id: 42 }]);
    const req = hmacReq("/api/notes", { title: "Hello", contentMd: "world" });
    const res = await POST(req);
    expect(res.status).toBe(201);
    // requireOwned was called with id=42 (default library)
    expect(vi.mocked(requireOwned)).toHaveBeenCalled();
    const callArgs = vi.mocked(requireOwned).mock.calls[0];
    expect(callArgs[1]).toBe(42);
  });

  it("returns 400 when user has no library and no libraryId supplied", async () => {
    mockDefaultLibraryLookup([]);
    const req = hmacReq("/api/notes", { title: "Hello", contentMd: "world" });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("no_library");
  });

  it("ignores notebookId field silently", async () => {
    const req = hmacReq("/api/notes", {
      libraryId: 7,
      title: "T",
      contentMd: "x",
      notebookId: "abc",
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
  });
});

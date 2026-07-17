/**
 * HMAC + UUID-or-slug tests for /api/notes/[id]. The agent `read_note` tool
 * passes either a UUID or a slug; the route must accept both transparently.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { internalAuthTestHeaders } from "@/__tests__/internal-auth-headers";

vi.mock("@/lib/db", () => ({ db: { select: vi.fn() } }));

import { db } from "@/lib/db";
import { GET } from "./route";

const SECRET = "test-secret-abc";
const UUID = "11111111-2222-3333-4444-555555555555";

function selectChain(rows: unknown[]) {
  const limitFn = vi.fn().mockResolvedValue(rows);
  const c = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: limitFn,
    // For requireOwned (UUID path): no .limit() in that flow — `.where().limit(1)`
    // is what requireOwned uses internally. Stubbed here to handle both flows.
  };
  vi.mocked(db.select).mockReturnValue(c as never);
  // Make sure the chain resolves to rows when awaited at the end of either chain
  return c;
}

function hmacReq(path: string): Request {
  return new Request(`http://localhost:3001${path}`, {
    headers: internalAuthTestHeaders({
      secret: SECRET,
      userId: "user-1",
      method: "GET",
      path,
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.INHALE_INTERNAL_SECRET = SECRET;
});
afterEach(() => {
  delete process.env.INHALE_INTERNAL_SECRET;
});

describe("GET /api/notes/[id] [HMAC + slug fallback]", () => {
  it("rejects no auth", async () => {
    const res = await GET(
      new Request("http://localhost/api/notes/foo"),
      { params: Promise.resolve({ id: "foo" }) },
    );
    expect(res.status).toBe(401);
  });

  it("rejects bad HMAC", async () => {
    const req = new Request("http://localhost/api/notes/foo", {
      headers: {
        "X-Inhale-User-Id": "u",
        "X-Inhale-Ts": String(Math.floor(Date.now() / 1000)),
        "X-Inhale-Sig": "bad".repeat(20),
        "X-Inhale-Sig-Version": "2",
      },
    });
    const res = await GET(req, { params: Promise.resolve({ id: "foo" }) });
    expect(res.status).toBe(401);
  });

  it("UUID path: returns row when found and owned", async () => {
    // requireOwned: db.select().from(table).where(eq(table.id, ...)).limit(1)
    selectChain([{ id: UUID, userId: "user-1", title: "T" }]);
    const req = hmacReq(`/api/notes/${UUID}`);
    const res = await GET(req, { params: Promise.resolve({ id: UUID }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(UUID);
  });

  it("UUID path: 403 when row owned by other user", async () => {
    selectChain([{ id: UUID, userId: "other-user", title: "T" }]);
    const req = hmacReq(`/api/notes/${UUID}`);
    const res = await GET(req, { params: Promise.resolve({ id: UUID }) });
    expect(res.status).toBe(403);
  });

  it("slug path: looks up by slug when not a UUID", async () => {
    selectChain([{ id: UUID, userId: "user-1", slug: "my-slug", title: "T" }]);
    const req = hmacReq("/api/notes/my-slug");
    const res = await GET(req, { params: Promise.resolve({ id: "my-slug" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.slug).toBe("my-slug");
  });

  it("slug path: 404 when no slug match", async () => {
    selectChain([]);
    const req = hmacReq("/api/notes/missing-slug");
    const res = await GET(req, { params: Promise.resolve({ id: "missing-slug" }) });
    expect(res.status).toBe(404);
  });
});

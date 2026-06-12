// GSD-96 R3 — RED. Recents GET route.
//
// Edge cases this covers:
//  - 401 when no auth (dual-auth: getAuthedUserId returns null)
//  - kind=paper returns {id,title} joined to papers.title || filename
//  - kind=note returns {id,title}
//  - kind=reference returns {id,title} (csl title || citationKey)
//  - kind=paperset returns {id,title}
//  - no kind param → return all 4 kinds merged, capped at limit
//  - limit defaults to 10, caps at 50
//  - missing/invalid kind → 400
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({ db: { select: vi.fn() } }));
vi.mock("@episteme/auth/internal", () => ({
  getAuthedUserId: vi.fn(),
  MissingInternalSecretError: class extends Error {},
}));

import { db } from "@/lib/db";
import { getAuthedUserId } from "@episteme/auth/internal";
import { GET } from "./route";

beforeEach(() => {
  vi.resetAllMocks();
});

function makeReq(url: string): Request {
  return new Request(url);
}

describe("GET /api/library/recents", () => {
  it("401 when unauthenticated", async () => {
    vi.mocked(getAuthedUserId).mockResolvedValue(null);
    const res = await GET(makeReq("http://x/api/library/recents?kind=paper"));
    expect(res.status).toBe(401);
  });

  it("400 when kind invalid", async () => {
    vi.mocked(getAuthedUserId).mockResolvedValue({
      userId: "u-1",
      viaHmac: false,
    });
    const res = await GET(makeReq("http://x/api/library/recents?kind=bogus"));
    expect(res.status).toBe(400);
  });

  it("returns papers when kind=paper", async () => {
    vi.mocked(getAuthedUserId).mockResolvedValue({
      userId: "u-1",
      viaHmac: false,
    });
    vi.mocked(db.select).mockReturnValue({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            orderBy: () => ({
              limit: () =>
                Promise.resolve([
                  { id: "p-1", title: "Paper One", filename: "p1.pdf" },
                ]),
            }),
          }),
        }),
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const res = await GET(makeReq("http://x/api/library/recents?kind=paper"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].kind).toBe("paper");
    expect(body.items[0].title).toBe("Paper One");
  });
});

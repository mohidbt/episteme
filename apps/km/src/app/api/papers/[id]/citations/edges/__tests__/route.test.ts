import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/internal-auth", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/internal-auth")>(
      "@/lib/internal-auth",
    );
  return { ...actual, getAuthedUserId: vi.fn() };
});
vi.mock("@/lib/db", () => ({
  db: { select: vi.fn() },
}));

import { getAuthedUserId } from "@/lib/internal-auth";
import { db } from "@/lib/db";
import { GET } from "../route";

const PAPER_ID = "00000000-0000-0000-0000-000000000001";

function buildReq(direction: "citing" | "cited-in" | null = "citing") {
  const url = direction
    ? `http://x/api/papers/${PAPER_ID}/citations/edges?direction=${direction}`
    : `http://x/api/papers/${PAPER_ID}/citations/edges`;
  return new Request(url) as unknown as import("next/server").NextRequest;
}
const routeParams = { params: Promise.resolve({ id: PAPER_ID }) };

beforeEach(() => vi.resetAllMocks());

function mockOwnership(userId: string | null) {
  vi.mocked(db.select).mockReturnValueOnce({
    from: () => ({
      where: () => ({
        limit: async () =>
          userId
            ? [{ id: PAPER_ID, userId }]
            : [],
      }),
    }),
  } as never);
}

describe("GET /api/papers/[id]/citations/edges", () => {
  it("401 when unauthenticated", async () => {
    vi.mocked(getAuthedUserId).mockResolvedValue(null);
    const res = await GET(buildReq(), routeParams);
    expect(res.status).toBe(401);
  });

  it("404 when paper missing", async () => {
    vi.mocked(getAuthedUserId).mockResolvedValue({ userId: "u1", viaHmac: false } as never);
    mockOwnership(null);
    const res = await GET(buildReq(), routeParams);
    expect(res.status).toBe(404);
  });

  it("403 when paper belongs to other user", async () => {
    vi.mocked(getAuthedUserId).mockResolvedValue({ userId: "u1", viaHmac: false } as never);
    mockOwnership("u2");
    const res = await GET(buildReq(), routeParams);
    expect(res.status).toBe(403);
  });

  it("400 when direction param is invalid", async () => {
    vi.mocked(getAuthedUserId).mockResolvedValue({ userId: "u1", viaHmac: false } as never);
    mockOwnership("u1");
    const res = await GET(
      new Request(
        `http://x/api/papers/${PAPER_ID}/citations/edges?direction=bogus`,
      ) as unknown as import("next/server").NextRequest,
      routeParams,
    );
    expect(res.status).toBe(400);
  });

  it("citing direction: returns edges with paper title (cited_kind=paper) and ref title (cited_kind=reference)", async () => {
    vi.mocked(getAuthedUserId).mockResolvedValue({ userId: "u1", viaHmac: false } as never);
    mockOwnership("u1");

    // Result rows simulating LEFT JOIN to papers + document_references for title resolution.
    const rows = [
      {
        id: 1,
        otherKind: "paper",
        otherId: "paper-xyz",
        title: "Cited Paper Title",
        markerIdx: 3,
      },
      {
        id: 2,
        otherKind: "reference",
        otherId: "42",
        title: "Bibliography Entry",
        markerIdx: 7,
      },
    ];

    vi.mocked(db.select).mockReturnValueOnce({
      from: () => ({
        leftJoin: () => ({
          leftJoin: () => ({
            where: () => ({
              orderBy: async () => rows,
            }),
          }),
        }),
      }),
    } as never);

    const res = await GET(buildReq("citing"), routeParams);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      edges: Array<{
        id: number;
        otherKind: string;
        otherId: string;
        title: string | null;
        markerIdx: number | null;
      }>;
    };
    expect(body.edges).toHaveLength(2);
    expect(body.edges[0]).toMatchObject({
      otherKind: "paper",
      otherId: "paper-xyz",
      title: "Cited Paper Title",
      markerIdx: 3,
    });
    expect(body.edges[1]).toMatchObject({
      otherKind: "reference",
      otherId: "42",
      title: "Bibliography Entry",
      markerIdx: 7,
    });
  });

  it("cited-in direction: returns edges with citer paper title", async () => {
    vi.mocked(getAuthedUserId).mockResolvedValue({ userId: "u1", viaHmac: false } as never);
    mockOwnership("u1");

    const rows = [
      {
        id: 11,
        otherKind: "paper",
        otherId: "paper-abc",
        title: "Citer Paper Title",
        markerIdx: 2,
      },
    ];

    vi.mocked(db.select).mockReturnValueOnce({
      from: () => ({
        leftJoin: () => ({
          leftJoin: () => ({
            where: () => ({
              orderBy: async () => rows,
            }),
          }),
        }),
      }),
    } as never);

    const res = await GET(buildReq("cited-in"), routeParams);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      edges: Array<{ otherKind: string; otherId: string; title: string | null }>;
    };
    expect(body.edges).toHaveLength(1);
    expect(body.edges[0].otherId).toBe("paper-abc");
    expect(body.edges[0].otherKind).toBe("paper");
  });

  it("defaults to citing direction when param omitted", async () => {
    vi.mocked(getAuthedUserId).mockResolvedValue({ userId: "u1", viaHmac: false } as never);
    mockOwnership("u1");
    vi.mocked(db.select).mockReturnValueOnce({
      from: () => ({
        leftJoin: () => ({
          leftJoin: () => ({
            where: () => ({ orderBy: async () => [] }),
          }),
        }),
      }),
    } as never);

    const res = await GET(buildReq(null), routeParams);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { edges: unknown[] };
    expect(body.edges).toEqual([]);
  });
});

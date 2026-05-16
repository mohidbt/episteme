import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => {
  return {
    db: { select: vi.fn() },
  };
});

import { db } from "@/lib/db";
import { getReferenceEdges } from "../reference-edges";

const USER_ID = "user-1";

// Stub a Drizzle-style chain ending in .orderBy() → rows.
function stubChain(rows: unknown[]) {
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
}

beforeEach(() => vi.resetAllMocks());

describe("getReferenceEdges(refId, userId)", () => {
  it("returns citedIn list: paper_citations rows where cited_kind='reference' AND cited_id=refId", async () => {
    // citedIn query (first call), then citing query (second call)
    stubChain([
      {
        id: 11,
        otherKind: "paper",
        otherId: "paper-aaa",
        title: "Citer Paper Title",
        markerIdx: 2,
      },
    ]);
    stubChain([]); // citing empty

    const result = await getReferenceEdges(42, USER_ID);

    expect(result.citedIn).toHaveLength(1);
    expect(result.citedIn[0]).toMatchObject({
      otherKind: "paper",
      otherId: "paper-aaa",
      title: "Citer Paper Title",
    });
    expect(result.citing).toEqual([]);
  });

  it("returns citing list: paper_citations rows where citer_kind='reference' AND citer_id=refId", async () => {
    stubChain([]); // citedIn empty
    stubChain([
      {
        id: 22,
        otherKind: "reference",
        otherId: "99",
        title: "Bibliography Entry",
        markerIdx: 5,
      },
    ]);

    const result = await getReferenceEdges(42, USER_ID);

    expect(result.citing).toHaveLength(1);
    expect(result.citing[0]).toMatchObject({
      otherKind: "reference",
      otherId: "99",
      title: "Bibliography Entry",
    });
  });

  it("user-scoped: cross-user paper title resolves to NULL (other-user paper)", async () => {
    // Simulates LEFT JOIN papers WHERE papers.user_id = userId — non-match → NULL title
    stubChain([
      {
        id: 33,
        otherKind: "paper",
        otherId: "paper-other-user",
        title: null,
        markerIdx: 1,
      },
    ]);
    stubChain([]);

    const result = await getReferenceEdges(42, USER_ID);

    expect(result.citedIn[0].title).toBeNull();
    expect(result.citedIn[0].otherId).toBe("paper-other-user");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const mocks = vi.hoisted(() => ({
  getUserIdFromRequest: vi.fn(),
  execute: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getUserIdFromRequest: mocks.getUserIdFromRequest,
}));
vi.mock("@episteme/db/client", () => ({
  db: { execute: mocks.execute },
}));

import { GET } from "./route";

const SRC = "11111111-1111-4111-8111-111111111111";
const DST = "22222222-2222-4222-8222-222222222222";

function request(srcKind: string, dstKind: string, srcId = SRC, dstId = DST) {
  const params = new URLSearchParams({ srcKind, dstKind, srcId, dstId });
  return new Request(`http://localhost/api/graph/edge-detail?${params}`);
}

function lastSql(): { sql: string; params: unknown[] } {
  const statement = mocks.execute.mock.calls.at(-1)?.[0];
  return new PgDialect().sqlToQuery(statement);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUserIdFromRequest.mockResolvedValue("owner-user");
  mocks.execute.mockResolvedValue({ rows: [] });
});

describe("GET /api/graph/edge-detail ownership", () => {
  it("requires authentication and validates UUIDs before querying", async () => {
    mocks.getUserIdFromRequest.mockResolvedValueOnce(null);
    expect((await GET(request("paper", "note"))).status).toBe(401);

    expect((await GET(request("paper", "note", "not-a-uuid"))).status).toBe(400);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  for (const [srcKind, dstKind] of [
    ["paper", "paper"],
    ["paper", "note"],
    ["note", "paper"],
    ["note", "note"],
  ] as const) {
    it(`scopes both ${srcKind}->${dstKind} endpoints to the current user`, async () => {
      const response = await GET(request(srcKind, dstKind));

      // An unknown or cross-tenant endpoint is indistinguishable from a
      // missing one, rather than returning an empty successful detail.
      expect(response.status).toBe(404);
      const query = lastSql();
      expect(query.sql).toContain("src_owner.user_id = $1");
      expect(query.sql).toContain("dst_owner.user_id = $3");
      expect(query.params).toEqual(["owner-user", DST, "owner-user", SRC]);
    });
  }

  for (const srcKind of ["paper", "note"] as const) {
    it(`scopes both sides of ${srcKind}->reference to the current user`, async () => {
      const response = await GET(request(srcKind, "reference"));

      expect(response.status).toBe(404);
      const query = lastSql();
      expect(query.sql).toContain("src_owner.user_id = $1");
      expect(query.sql).toContain("dst_ref.user_id = $3");
      expect(query.params).toEqual(["owner-user", DST, "owner-user", SRC]);
    });
  }

  it("returns detail only when the ownership-scoped query produces a row", async () => {
    mocks.execute.mockResolvedValueOnce({
      rows: [{ src_excerpt: "mine", dst_excerpt: "also mine", cosine: 0.75 }],
    });

    const response = await GET(request("paper", "note"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      src_excerpt: "mine",
      dst_excerpt: "also mine",
      cosine: 0.75,
    });
  });
});

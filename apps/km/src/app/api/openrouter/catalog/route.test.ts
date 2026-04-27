import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { GET } from "./route";
import { db } from "@/lib/db";
import { openrouterCatalog } from "@episteme/db/schema";

const TEST_IDS = [
  "test/openrouter-catalog-route-a",
  "test/openrouter-catalog-route-b",
];

async function clearTestRows() {
  await db
    .delete(openrouterCatalog)
    .where(inArray(openrouterCatalog.modelId, TEST_IDS));
}

beforeAll(async () => {
  await clearTestRows();
});

afterEach(async () => {
  await clearTestRows();
});

afterAll(async () => {
  await clearTestRows();
});

describe("GET /api/openrouter/catalog", () => {
  it("returns empty list when no rows match (table-level)", async () => {
    const r = await GET();
    expect(r.status).toBe(200);
    const body = (await r.json()) as {
      models: unknown[];
      fetched_at: string | null;
    };
    expect(Array.isArray(body.models)).toBe(true);
    // We can't assert empty (other rows may exist in shared DB) but our test
    // models must not be present.
    const ids = body.models.map((m) => (m as { id: string }).id);
    for (const tid of TEST_IDS) {
      expect(ids).not.toContain(tid);
    }
  });

  it("returns rows after insert (newest first via fetched_at desc)", async () => {
    const older = new Date("2026-04-25T10:00:00.000Z");
    const newer = new Date("2026-04-26T10:00:00.000Z");

    await db.insert(openrouterCatalog).values([
      {
        modelId: TEST_IDS[0],
        payload: { id: TEST_IDS[0], name: "A", supported_parameters: ["tools"] },
        fetchedAt: older,
      },
      {
        modelId: TEST_IDS[1],
        payload: { id: TEST_IDS[1], name: "B", supported_parameters: ["tools"] },
        fetchedAt: newer,
      },
    ]);

    const r = await GET();
    expect(r.status).toBe(200);
    const body = (await r.json()) as {
      models: { id: string; name: string }[];
      fetched_at: string | null;
    };

    const ours = body.models.filter((m) => TEST_IDS.includes(m.id));
    expect(ours).toHaveLength(2);
    // First of ours must be the newer one — since rows are sorted by fetched_at DESC.
    const idxNewer = body.models.findIndex((m) => m.id === TEST_IDS[1]);
    const idxOlder = body.models.findIndex((m) => m.id === TEST_IDS[0]);
    expect(idxNewer).toBeGreaterThanOrEqual(0);
    expect(idxNewer).toBeLessThan(idxOlder);

    expect(body.fetched_at).not.toBeNull();
    // fetched_at on the response should be >= our newer timestamp.
    expect(new Date(body.fetched_at!).getTime()).toBeGreaterThanOrEqual(
      newer.getTime(),
    );
  });
});

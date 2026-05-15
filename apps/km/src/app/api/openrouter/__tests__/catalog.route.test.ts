import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock @/lib/db before importing the route — the route reads `db.select(...)`.
vi.mock("@/lib/db", () => ({
  db: { select: vi.fn() },
}));

import { db } from "@/lib/db";
import { GET } from "../catalog/route";

const AGENTS_URL = "http://agents.test";

// Helper: build the drizzle chain `select().from().orderBy()` returning rows.
function mockRows(rows: Array<{ payload: unknown; fetchedAt: Date }>) {
  vi.mocked(db.select).mockReturnValueOnce({
    from: () => ({
      orderBy: async () => rows,
    }),
  } as never);
}

const originalAgentsUrl = process.env.AGENTS_URL;
const originalFetch = global.fetch;

beforeEach(() => {
  vi.resetAllMocks();
  process.env.AGENTS_URL = AGENTS_URL;
  global.fetch = vi.fn(async () =>
    new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
  ) as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
  if (originalAgentsUrl === undefined) delete process.env.AGENTS_URL;
  else process.env.AGENTS_URL = originalAgentsUrl;
});

describe("GET /api/openrouter/catalog", () => {
  it("empty rows → 200, stale:true, fires refresh once toward agents", async () => {
    mockRows([]);

    const r = await GET();
    expect(r.status).toBe(200);
    const body = (await r.json()) as {
      models: unknown[];
      fetched_at: string | null;
      stale: boolean;
    };
    expect(body.models).toEqual([]);
    expect(body.fetched_at).toBeNull();
    expect(body.stale).toBe(true);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    expect(url).toBe(`${AGENTS_URL}/openrouter/catalog/refresh`);
    expect(init.method).toBe("POST");
  });

  it("fresh rows (<24h) → no fetch fired, stale:false", async () => {
    const now = new Date();
    const fresh = new Date(now.getTime() - 60 * 60 * 1000); // 1h ago
    mockRows([
      { payload: { id: "m1" }, fetchedAt: fresh },
      { payload: { id: "m2" }, fetchedAt: fresh },
      { payload: { id: "m3" }, fetchedAt: fresh },
      { payload: { id: "m4" }, fetchedAt: fresh },
      { payload: { id: "m5" }, fetchedAt: fresh },
    ]);

    const r = await GET();
    expect(r.status).toBe(200);
    const body = (await r.json()) as {
      models: unknown[];
      fetched_at: string | null;
      stale: boolean;
    };
    expect(body.models).toHaveLength(5);
    expect(body.stale).toBe(false);
    expect(body.fetched_at).not.toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("rows with oldest >24h → fetch fired, stale:true", async () => {
    const now = new Date();
    const newest = new Date(now.getTime() - 60 * 60 * 1000); // 1h ago (DESC head)
    const oldest = new Date(now.getTime() - 25 * 60 * 60 * 1000); // 25h ago (DESC tail)
    mockRows([
      { payload: { id: "m1" }, fetchedAt: newest },
      { payload: { id: "m2" }, fetchedAt: oldest },
    ]);

    const r = await GET();
    expect(r.status).toBe(200);
    const body = (await r.json()) as {
      models: unknown[];
      fetched_at: string | null;
      stale: boolean;
    };
    expect(body.models).toHaveLength(2);
    expect(body.stale).toBe(true);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url] = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    expect(url).toBe(`${AGENTS_URL}/openrouter/catalog/refresh`);
  });
});

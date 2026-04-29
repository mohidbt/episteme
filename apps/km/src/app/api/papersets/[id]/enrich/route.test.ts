import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

vi.mock("@episteme/auth/byok", () => ({
  getDecryptedApiKey: vi.fn(),
}));

import { getDecryptedApiKey } from "@episteme/auth/byok";
import { db } from "@/lib/db";
import { papers, papersets, libraries } from "@episteme/db/schema";
import { POST } from "./route";
import { POST as POST_PAPERSET } from "../../route";
import { POST as POST_ROWS } from "../rows/route";
import { POST as POST_LIB } from "../../../libraries/route";
import { createTestUser, deleteTestUser, params, req, type TestUser } from "../../../_test-utils";

let u: TestUser;
let other: TestUser;
let libraryId: number;

const originalFetch = global.fetch;
const originalAgentsUrl = process.env.AGENTS_URL;
const originalSecret = process.env.INHALE_INTERNAL_SECRET;

beforeAll(async () => {
  u = await createTestUser();
  other = await createTestUser();
  const r = await POST_LIB(
    req("/api/libraries", { method: "POST", cookie: u.cookie, body: JSON.stringify({ name: "Enrich Lib" }) }),
  );
  libraryId = (await r.json()).id;
}, 60_000);

afterAll(async () => {
  await db.delete(papers).where(eq(papers.userId, u.id));
  await db.delete(libraries).where(eq(libraries.id, libraryId));
  await deleteTestUser(u.id);
  await deleteTestUser(other.id);
});

beforeEach(() => {
  process.env.INHALE_INTERNAL_SECRET = "test-secret-abc";
  process.env.AGENTS_URL = "http://test-agents:8000";
  vi.mocked(getDecryptedApiKey).mockResolvedValue("sk-test-key");
});

afterEach(() => {
  vi.restoreAllMocks();
  global.fetch = originalFetch;
  if (originalAgentsUrl === undefined) delete process.env.AGENTS_URL;
  else process.env.AGENTS_URL = originalAgentsUrl;
  if (originalSecret === undefined) delete process.env.INHALE_INTERNAL_SECRET;
  else process.env.INHALE_INTERNAL_SECRET = originalSecret;
});

async function seedPaperset(opts: { columns?: Array<{ name: string; description: string }> } = {}): Promise<string> {
  const r = await POST_PAPERSET(
    req("/api/papersets", {
      method: "POST",
      cookie: u.cookie,
      body: JSON.stringify({
        filename: `enrich-${Math.random().toString(36).slice(2, 8)}.csv`,
        folderId: null,
        columns: opts.columns ?? [{ name: "x", description: "desc x" }],
      }),
    }),
  );
  if (r.status !== 201) throw new Error(`seed paperset failed: ${r.status}`);
  return (await r.json()).id as string;
}

async function seedPaper(): Promise<string> {
  const [row] = await db
    .insert(papers)
    .values({
      userId: u.id,
      libraryId,
      filename: `paper-${Math.random().toString(36).slice(2, 8)}.pdf`,
    })
    .returning({ id: papers.id });
  return row.id;
}

async function addRow(papersetId: string, paperId: string): Promise<void> {
  await POST_ROWS(
    req(`/api/papersets/${papersetId}/rows`, {
      method: "POST",
      cookie: u.cookie,
      body: JSON.stringify({ paperIds: [paperId] }),
    }),
    params({ id: papersetId }),
  );
}

describe("POST /api/papersets/:id/enrich", () => {
  it("rejects unauth", async () => {
    const res = await POST(
      new Request("http://x/api/papersets/00000000-0000-0000-0000-000000000000/enrich", {
        method: "POST",
        body: "{}",
        headers: { "content-type": "application/json" },
      }),
      params({ id: "00000000-0000-0000-0000-000000000000" }),
    );
    expect(res.status).toBe(401);
  });

  it("404 on missing paperset", async () => {
    const res = await POST(
      req(`/api/papersets/00000000-0000-0000-0000-000000000000/enrich`, {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ cells: [{ row_idx: 0, col_name: "x" }] }),
      }),
      params({ id: "00000000-0000-0000-0000-000000000000" }),
    );
    expect(res.status).toBe(404);
  });

  it("403 on cross-user", async () => {
    const id = await seedPaperset();
    const paper = await seedPaper();
    await addRow(id, paper);
    const res = await POST(
      req(`/api/papersets/${id}/enrich`, {
        method: "POST",
        cookie: other.cookie,
        body: JSON.stringify({ cells: [{ row_idx: 0, col_name: "x" }] }),
      }),
      params({ id }),
    );
    expect(res.status).toBe(403);
  });

  it("400 on empty cells array", async () => {
    const id = await seedPaperset();
    const paper = await seedPaper();
    await addRow(id, paper);
    const res = await POST(
      req(`/api/papersets/${id}/enrich`, {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ cells: [] }),
      }),
      params({ id }),
    );
    expect(res.status).toBe(400);
  });

  it("400 on row_idx out of bounds", async () => {
    const id = await seedPaperset();
    const paper = await seedPaper();
    await addRow(id, paper); // 1 row
    const res = await POST(
      req(`/api/papersets/${id}/enrich`, {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ cells: [{ row_idx: 5, col_name: "x" }] }),
      }),
      params({ id }),
    );
    expect(res.status).toBe(400);
  });

  it("400 on unknown col_name", async () => {
    const id = await seedPaperset();
    const paper = await seedPaper();
    await addRow(id, paper);
    const res = await POST(
      req(`/api/papersets/${id}/enrich`, {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ cells: [{ row_idx: 0, col_name: "nope" }] }),
      }),
      params({ id }),
    );
    expect(res.status).toBe(400);
  });

  it("409 if running_cells is non-empty", async () => {
    const id = await seedPaperset();
    const paper = await seedPaper();
    await addRow(id, paper);
    await db
      .update(papersets)
      .set({ runningCells: [{ row: 0, col: "x" }] })
      .where(eq(papersets.id, id));
    const res = await POST(
      req(`/api/papersets/${id}/enrich`, {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ cells: [{ row_idx: 0, col_name: "x" }] }),
      }),
      params({ id }),
    );
    expect(res.status).toBe(409);
  });

  it("400 add_openrouter_key when user has no key", async () => {
    const id = await seedPaperset();
    const paper = await seedPaper();
    await addRow(id, paper);
    vi.mocked(getDecryptedApiKey).mockRejectedValueOnce(new Error("no key"));
    const res = await POST(
      req(`/api/papersets/${id}/enrich`, {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ cells: [{ row_idx: 0, col_name: "x" }] }),
      }),
      params({ id }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("add_openrouter_key");
  });

  it("sets running_cells, calls upstream with signed request, proxies SSE chunks", async () => {
    const id = await seedPaperset();
    const paper = await seedPaper();
    await addRow(id, paper);

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(
              new TextEncoder().encode(`event: cell_update\ndata: {"row":0,"col":"x","value":"FOO"}\n\n`),
            );
            c.close();
          },
        }),
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      ),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const res = await POST(
      req(`/api/papersets/${id}/enrich`, {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ cells: [{ row_idx: 0, col_name: "x" }] }),
      }),
      params({ id }),
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("event: cell_update");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/agents/km/extract");
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Inhale-User-Id"]).toBe(u.id);
    expect(headers["X-Inhale-LLM-Key"]).toBe("sk-test-key");
    expect(headers["X-Inhale-Ts"]).toBeDefined();
    expect(headers["X-Inhale-Sig"]).toBeDefined();

    const [updated] = await db.select().from(papersets).where(eq(papersets.id, id));
    expect(updated.runningCells).toEqual([]);
  });

  it("emits error event when upstream returns 501", async () => {
    const id = await seedPaperset();
    const paper = await seedPaper();
    await addRow(id, paper);

    global.fetch = vi.fn().mockResolvedValue(
      new Response("not implemented", { status: 501 }),
    ) as unknown as typeof fetch;

    const res = await POST(
      req(`/api/papersets/${id}/enrich`, {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ cells: [{ row_idx: 0, col_name: "x" }] }),
      }),
      params({ id }),
    );
    const text = await res.text();
    expect(text).toContain("event: error");
    expect(text).toContain('"code":"not_implemented"');

    const [updated] = await db.select().from(papersets).where(eq(papersets.id, id));
    expect(updated.runningCells).toEqual([]);
  });

  it("emits error event when fetch throws (connect refused)", async () => {
    const id = await seedPaperset();
    const paper = await seedPaper();
    await addRow(id, paper);

    global.fetch = vi.fn().mockRejectedValue(
      Object.assign(new Error("connect ECONNREFUSED"), { cause: "ECONNREFUSED" }),
    ) as unknown as typeof fetch;

    const res = await POST(
      req(`/api/papersets/${id}/enrich`, {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ cells: [{ row_idx: 0, col_name: "x" }] }),
      }),
      params({ id }),
    );
    const text = await res.text();
    expect(text).toContain("event: error");
    expect(text).toContain('"code":"upstream_unavailable"');

    const [updated] = await db.select().from(papersets).where(eq(papersets.id, id));
    expect(updated.runningCells).toEqual([]);
  });
});

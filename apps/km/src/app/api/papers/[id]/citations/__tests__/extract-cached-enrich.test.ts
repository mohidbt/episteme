// Regression: when /citations/extract hits the cached-return branch (paper
// already has documentReferences rows), the route MUST still enqueue an S2
// enrichment job for any rows where semanticScholarId IS NULL. Enqueue is
// cheap (single DB upsert); the cron drains the queue. Running the S2 loop
// inline in after() previously billed ~30s Active CPU per cached read.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  return {
    ...actual,
    // Invoke after() callbacks synchronously in tests so we can assert on
    // their effects within the same tick as the route response.
    after: (cb: () => Promise<void> | void) => {
      void Promise.resolve().then(() => cb());
    },
  };
});

vi.mock("@episteme/auth", () => ({
  auth: { api: { getSession: vi.fn() } },
}));
vi.mock("@episteme/auth/byok", () => ({
  getDecryptedApiKey: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  db: { select: vi.fn() },
}));
vi.mock("@/lib/citations/enrichment-jobs", () => ({
  enqueueCitationEnrichmentJob: vi.fn().mockResolvedValue({}),
}));
// Spy on the slow inline path. If anyone re-wires the extract route to
// call this in after(), the CPU-budget regression guard below fires.
vi.mock("@/lib/citations/enrich-paper", () => ({
  enrichPaperReferencesInDb: vi.fn().mockResolvedValue({ enriched: 0, total: 0 }),
}));
vi.mock("@/lib/citations/auto-link", () => ({
  autoLinkPaperCitations: vi.fn().mockResolvedValue(undefined),
}));

import { auth } from "@episteme/auth";
import { db } from "@/lib/db";
import { enqueueCitationEnrichmentJob } from "@/lib/citations/enrichment-jobs";
import { enrichPaperReferencesInDb } from "@/lib/citations/enrich-paper";
import { POST } from "../extract/route";

const PAPER_ID = "00000000-0000-0000-0000-000000000001";
const buildReq = () =>
  new Request(`http://x/api/papers/${PAPER_ID}/citations/extract`, {
    method: "POST",
  }) as unknown as import("next/server").NextRequest;
const routeParams = { params: Promise.resolve({ id: PAPER_ID }) };

beforeEach(() => {
  vi.resetAllMocks();
});

describe("POST /api/papers/[id]/citations/extract — cached branch re-enqueue", () => {
  it("enqueues S2 enrichment job when cached refs include rows with null semanticScholarId", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1" } } as never);

    // 1st db.select: ownership lookup → returns the paper owned by u1.
    vi.mocked(db.select).mockReturnValueOnce({
      from: () => ({
        where: () => ({
          limit: async () => [{ id: PAPER_ID, userId: "u1", storageUrl: "/tmp/p.pdf" }],
        }),
      }),
    } as never);

    // 2nd db.select: existing refs check → returns rows, some with null S2 id.
    vi.mocked(db.select).mockReturnValueOnce({
      from: () => ({
        where: async () => [
          { id: 1, paperId: PAPER_ID, markerIndex: 1, semanticScholarId: null },
          { id: 2, paperId: PAPER_ID, markerIndex: 2, semanticScholarId: "abc123" },
        ],
      }),
    } as never);

    const res = await POST(buildReq(), routeParams);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { alreadyExtracted?: boolean };
    expect(body.alreadyExtracted).toBe(true);

    // Allow the queued after() microtask to flush.
    await new Promise((r) => setTimeout(r, 0));

    expect(enqueueCitationEnrichmentJob).toHaveBeenCalledWith(PAPER_ID);
  });

  it("does NOT call the inline S2 loop from the cached branch", async () => {
    // Regression guard for the Jun 8 Fluid Active CPU spike. Calling
    // enrichPaperReferencesInDb in after() bills ~30s billed Active CPU
    // per cached read (sleep(1100) * refs). Any re-wiring of the inline
    // path from the extract route must fail this test.
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1" } } as never);
    vi.mocked(db.select).mockReturnValueOnce({
      from: () => ({
        where: () => ({
          limit: async () => [{ id: PAPER_ID, userId: "u1", storageUrl: "/tmp/p.pdf" }],
        }),
      }),
    } as never);
    vi.mocked(db.select).mockReturnValueOnce({
      from: () => ({
        where: async () => [
          { id: 1, paperId: PAPER_ID, markerIndex: 1, semanticScholarId: null },
        ],
      }),
    } as never);

    await POST(buildReq(), routeParams);
    await new Promise((r) => setTimeout(r, 0));

    expect(enrichPaperReferencesInDb).not.toHaveBeenCalled();
  });

  it("cached branch + after() flush completes under 100ms", async () => {
    // Wall-clock guard. With mocks the route is structurally I/O-free;
    // anything over 100ms means someone added a sleep, an unmocked
    // network call, or a synchronous CPU loop on the hot path.
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1" } } as never);
    vi.mocked(db.select).mockReturnValueOnce({
      from: () => ({
        where: () => ({
          limit: async () => [{ id: PAPER_ID, userId: "u1", storageUrl: "/tmp/p.pdf" }],
        }),
      }),
    } as never);
    vi.mocked(db.select).mockReturnValueOnce({
      from: () => ({
        where: async () => [
          { id: 1, paperId: PAPER_ID, markerIndex: 1, semanticScholarId: null },
        ],
      }),
    } as never);

    const t0 = performance.now();
    await POST(buildReq(), routeParams);
    await new Promise((r) => setTimeout(r, 0));
    const elapsed = performance.now() - t0;

    expect(elapsed).toBeLessThan(100);
  });
});

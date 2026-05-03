import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@episteme/auth", () => ({
  auth: { api: { getSession: vi.fn() } },
}));
vi.mock("@/lib/db", () => ({
  db: { select: vi.fn() },
}));
vi.mock("@/lib/ai/pdf-text", () => ({ extractPdfPages: vi.fn() }));
vi.mock("@/lib/citations/annotation-extractor", () => ({
  extractAnnotationMarkers: vi.fn(),
}));

import { auth } from "@episteme/auth";
import { db } from "@/lib/db";
import { POST } from "./route";

const PAPER_ID = "00000000-0000-0000-0000-000000000001";
const buildReq = () =>
  new Request(`http://x/api/papers/${PAPER_ID}/citations/extract`, { method: "POST" }) as unknown as import("next/server").NextRequest;
const routeParams = { params: Promise.resolve({ id: PAPER_ID }) };

beforeEach(() => vi.resetAllMocks());

describe("POST /api/papers/[id]/citations/extract", () => {
  it("401 when unauthenticated", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    const res = await POST(buildReq(), routeParams);
    expect(res.status).toBe(401);
  });

  it("404 when paper missing", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1" } } as never);
    vi.mocked(db.select).mockReturnValueOnce({
      from: () => ({ where: () => ({ limit: async () => [] }) }),
    } as never);
    const res = await POST(buildReq(), routeParams);
    expect(res.status).toBe(404);
  });

  it("422 when paper has no storageUrl", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1" } } as never);
    vi.mocked(db.select).mockReturnValueOnce({
      from: () => ({
        where: () => ({
          limit: async () => [{ id: PAPER_ID, userId: "u1", storageUrl: null }],
        }),
      }),
    } as never);
    const res = await POST(buildReq(), routeParams);
    expect(res.status).toBe(422);
  });
});

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
import { extractPdfPages } from "@/lib/ai/pdf-text";
import { extractAnnotationMarkers } from "@/lib/citations/annotation-extractor";
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

  it("falls back to derived source key when paper storageUrl is missing", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1" } } as never);
    vi.mocked(db.select).mockReturnValueOnce({
      from: () => ({
        where: () => ({
          limit: async () => [{ id: PAPER_ID, userId: "u1", storageUrl: null }],
        }),
      }),
    } as never);
    vi.mocked(extractAnnotationMarkers).mockRejectedValueOnce(
      new Error("[annotation-extractor] AGENTS_URL missing"),
    );
    vi.mocked(extractPdfPages).mockRejectedValueOnce(
      new Error("[pdf-text] AGENTS_URL missing"),
    );
    const res = await POST(buildReq(), routeParams);
    expect(res.status).toBe(200);
    expect(extractAnnotationMarkers).toHaveBeenCalledWith(
      `${PAPER_ID}/source.pdf`,
      expect.any(Object),
    );
    expect(await res.json()).toMatchObject({ unavailable: true });
  });

  it("returns empty successful payload when upstream extraction dependency is unavailable", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1" } } as never);
    vi.mocked(db.select).mockReturnValueOnce({
      from: () => ({
        where: () => ({
          limit: async () => [{ id: PAPER_ID, userId: "u1", storageUrl: "/tmp/paper.pdf" }],
        }),
      }),
    } as never);
    vi.mocked(extractAnnotationMarkers).mockRejectedValueOnce(
      new Error("[annotation-extractor] AGENTS_URL missing"),
    );
    vi.mocked(extractPdfPages).mockRejectedValueOnce(
      new Error("[pdf-text] AGENTS_URL missing"),
    );

    const res = await POST(buildReq(), routeParams);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      references: [],
      unavailable: true,
      stats: { extractionMethod: "unavailable" },
    });
  });
});

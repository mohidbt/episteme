// @vitest-environment node
//
// GSD-41 — agent-side multimodal parsing fetches asset metadata via the
// internal HMAC channel. The existing GET /api/assets/[id] handler was
// cookie-only (`getUserIdFromRequest`), which 401s every HMAC call from
// the agent sidecar (see memory note `feedback_agent_dual_auth`). This
// test pins the dual-auth (cookie + HMAC) behaviour.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/internal-auth", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/internal-auth")>(
      "@/lib/internal-auth",
    );
  return { ...actual, getAuthedUserId: vi.fn() };
});

vi.mock("@/lib/crud", async () => {
  const actual = await vi.importActual<typeof import("@/lib/crud")>("@/lib/crud");
  return {
    ...actual,
    requireOwned: vi.fn(),
  };
});

vi.mock("@/lib/storage", () => ({
  storage: {
    getPresignedGet: vi.fn(async () => "https://signed.example/asset/x"),
  },
  assetSourceKey: (id: string) => `assets/${id}/source`,
}));

import { getAuthedUserId } from "@/lib/internal-auth";
import { requireOwned } from "@/lib/crud";

beforeEach(() => {
  vi.mocked(getAuthedUserId).mockReset();
  vi.mocked(requireOwned).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const ctx = { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000001" }) };

describe("GET /api/assets/[id] HMAC dual-auth (GSD-41)", () => {
  it("401 when unauthenticated", async () => {
    vi.mocked(getAuthedUserId).mockResolvedValue(null);
    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/assets/x"), ctx);
    expect(res.status).toBe(401);
  });

  it("returns asset metadata + downloadUrl for cookie session", async () => {
    vi.mocked(getAuthedUserId).mockResolvedValue({ userId: "u1", viaHmac: false });
    vi.mocked(requireOwned).mockResolvedValue({
      ok: true,
      row: {
        id: "00000000-0000-0000-0000-000000000001",
        userId: "u1",
        filename: "pic.png",
        mimeType: "image/png",
        sizeBytes: 100,
      },
    } as never);
    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/assets/x"), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.filename).toBe("pic.png");
    expect(body.downloadUrl).toBe("https://signed.example/asset/x");
  });

  it("returns asset metadata for HMAC-signed agent request", async () => {
    vi.mocked(getAuthedUserId).mockResolvedValue({ userId: "agent-u1", viaHmac: true });
    vi.mocked(requireOwned).mockResolvedValue({
      ok: true,
      row: {
        id: "00000000-0000-0000-0000-000000000001",
        userId: "agent-u1",
        filename: "pic.png",
        mimeType: "image/png",
        sizeBytes: 100,
      },
    } as never);
    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/assets/x"), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.downloadUrl).toBe("https://signed.example/asset/x");
  });
});

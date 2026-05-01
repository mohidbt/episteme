// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  getSessionInfo: vi.fn(),
}));

vi.mock("@/lib/agent-config-bundle", () => ({
  buildBundle: vi.fn(),
}));

import { getSessionInfo } from "@/lib/auth";
import { buildBundle } from "@/lib/agent-config-bundle";

beforeEach(() => {
  vi.mocked(getSessionInfo).mockResolvedValue({ userId: "u1", isAnonymous: false });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/agent/export", () => {
  it("401 when unauthenticated", async () => {
    vi.mocked(getSessionInfo).mockResolvedValue(null);
    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/agent/export"));
    expect(res.status).toBe(401);
  });

  it("200 streams zip body for authed user", async () => {
    const zipBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);
    vi.mocked(buildBundle).mockResolvedValue(zipBytes);
    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/agent/export"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/zip");
    expect(res.headers.get("Content-Disposition")).toMatch(/attachment; filename=/);
    const buf = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(buf)).toEqual(Array.from(zipBytes));
    expect(buildBundle).toHaveBeenCalledWith("u1");
  });
});

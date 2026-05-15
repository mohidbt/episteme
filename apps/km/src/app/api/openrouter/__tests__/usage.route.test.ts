// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock auth — the route reads session via getSessionInfo.
vi.mock("@/lib/auth", () => ({
  getSessionInfo: vi.fn(),
}));

// Mock the aggregate helper so we exercise route behavior in isolation.
vi.mock("@/lib/openrouter-usage", () => ({
  getRecentSpendUsd: vi.fn(),
  OR_USER_SOFT_LIMIT_USD: 5,
  OR_GUEST_SOFT_LIMIT_USD: 1,
}));

import { getSessionInfo } from "@/lib/auth";
import { getRecentSpendUsd } from "@/lib/openrouter-usage";
import { GET } from "../usage/route";

beforeEach(() => {
  vi.mocked(getSessionInfo).mockReset();
  vi.mocked(getRecentSpendUsd).mockReset();
});

describe("GET /api/openrouter/usage", () => {
  it("returns 401 with no session", async () => {
    vi.mocked(getSessionInfo).mockResolvedValue(null);
    const r = await GET(new Request("http://test/api/openrouter/usage"));
    expect(r.status).toBe(401);
  });

  it("returns totalUsd + limitUsd=5 for signed-in user", async () => {
    vi.mocked(getSessionInfo).mockResolvedValue({
      userId: "user_abc",
      isAnonymous: false,
    });
    vi.mocked(getRecentSpendUsd).mockResolvedValue({
      totalUsd: 1.23,
      byModel: [{ model: "openai/gpt-4o", usd: 1.23 }],
    });

    const r = await GET(new Request("http://test/api/openrouter/usage"));
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body).toEqual({
      totalUsd: 1.23,
      byModel: [{ model: "openai/gpt-4o", usd: 1.23 }],
      isGuest: false,
      limitUsd: 5,
    });
    // Called with (userId, null)
    expect(getRecentSpendUsd).toHaveBeenCalledWith("user_abc", null);
  });

  it("returns limitUsd=1 + isGuest=true for anonymous user; scopes to guest id", async () => {
    vi.mocked(getSessionInfo).mockResolvedValue({
      userId: "anon_xyz",
      isAnonymous: true,
    });
    vi.mocked(getRecentSpendUsd).mockResolvedValue({
      totalUsd: 0.42,
      byModel: [],
    });

    const r = await GET(new Request("http://test/api/openrouter/usage"));
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.isGuest).toBe(true);
    expect(body.limitUsd).toBe(1);
    expect(body.totalUsd).toBe(0.42);
    // Anonymous → query by guest id, not user id.
    expect(getRecentSpendUsd).toHaveBeenCalledWith(null, "anon_xyz");
  });
});

// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  getSessionInfo: vi.fn(),
}));

vi.mock("@/lib/internal-auth", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/internal-auth")>(
      "@/lib/internal-auth",
    );
  return { ...actual, getAuthedUserId: vi.fn() };
});

vi.mock("@/lib/openrouter-key", () => ({
  getOrApiKey: vi.fn(async () => "sk-key"),
  OpenRouterKeyMissing: class OpenRouterKeyMissing extends Error {},
}));

import { getSessionInfo } from "@/lib/auth";
import { getAuthedUserId } from "@/lib/internal-auth";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.mocked(getSessionInfo).mockReset();
  vi.mocked(getAuthedUserId).mockReset();
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/ai-fill HMAC dual-auth", () => {
  it("401 when neither cookie nor HMAC authenticates", async () => {
    vi.mocked(getSessionInfo).mockResolvedValue(null);
    vi.mocked(getAuthedUserId).mockResolvedValue(null);
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/ai-fill", {
        method: "POST",
        body: JSON.stringify({ kind: "paper", known: {}, missing: ["title"] }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("accepts HMAC-signed request (treats as non-anonymous)", async () => {
    vi.mocked(getSessionInfo).mockResolvedValue(null);
    vi.mocked(getAuthedUserId).mockImplementation(async (req) => {
      if (req.headers.get("x-inhale-sig"))
        return { userId: "agent-u1", viaHmac: true };
      return null;
    });
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ title: "T" }) } }],
        }),
        { status: 200 },
      ),
    );
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/ai-fill", {
        method: "POST",
        body: JSON.stringify({ kind: "paper", known: {}, missing: ["title"] }),
        headers: {
          "content-type": "application/json",
          "X-Inhale-User-Id": "agent-u1",
          "X-Inhale-Ts": String(Math.floor(Date.now() / 1000)),
          "X-Inhale-Sig": "deadbeef",
        },
      }),
    );
    expect(res.status).toBe(200);
  });
});

// G17 — AI fill route tests
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@episteme/auth/byok", () => ({
  getDecryptedApiKey: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({
  getSessionInfo: vi.fn(),
}));
// GSD-126 P0: the resolver short-circuits BYOK on no-row to avoid
// EPISTEME_SHARED_LLM_KEY shadowing the managed-bucket path. These tests
// pre-date that change and assume BYOK is always present for signed-in
// callers, so default the mock to true and individual tests override.
vi.mock("@/lib/byok-presence", () => ({
  hasUserBYOK: vi.fn(),
}));

import { POST } from "./route";
import { getDecryptedApiKey } from "@episteme/auth/byok";
import { getSessionInfo } from "@/lib/auth";
import { hasUserBYOK } from "@/lib/byok-presence";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  vi.mocked(hasUserBYOK).mockResolvedValue(true);
});

function makeReq(body: unknown): Request {
  return new Request("http://localhost/api/ai-fill", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/ai-fill", () => {
  it("rejects unauthenticated requests", async () => {
    vi.mocked(getSessionInfo).mockResolvedValue(null);
    const res = await POST(makeReq({ kind: "paper", known: {}, missing: ["title"] }));
    expect(res.status).toBe(401);
  });

  it("returns 400 when missing fields are not requested", async () => {
    vi.mocked(getSessionInfo).mockResolvedValue({ userId: "u1", isAnonymous: false });
    vi.mocked(getDecryptedApiKey).mockResolvedValue("sk-key");
    const res = await POST(makeReq({ kind: "paper", known: {}, missing: [] }));
    expect(res.status).toBe(400);
  });

  it("calls OpenRouter with gemma model and returns suggested values", async () => {
    vi.mocked(getSessionInfo).mockResolvedValue({ userId: "u1", isAnonymous: false });
    vi.mocked(getDecryptedApiKey).mockResolvedValue("sk-key");
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({ title: "Attention is All You Need", year: 2017 }),
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const res = await POST(
      makeReq({
        kind: "paper",
        known: { filename: "1706.03762.pdf", authors: ["Vaswani"] },
        missing: ["title", "year"],
      }),
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { suggestions: Record<string, unknown> };
    expect(data.suggestions).toEqual({ title: "Attention is All You Need", year: 2017 });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("openrouter.ai");
    const sentBody = JSON.parse((init as RequestInit).body as string);
    expect(sentBody.model).toBe("openai/gpt-5.4-nano");
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer sk-key",
    });
  });

  it("returns 502 when OpenRouter fails", async () => {
    vi.mocked(getSessionInfo).mockResolvedValue({ userId: "u1", isAnonymous: false });
    vi.mocked(getDecryptedApiKey).mockResolvedValue("sk-key");
    fetchMock.mockResolvedValue(new Response("server error", { status: 500 }));

    const res = await POST(
      makeReq({ kind: "paper", known: {}, missing: ["title"] }),
    );
    expect(res.status).toBe(502);
  });

  it("returns OPENROUTER_KEY_MISSING when guest has no env key", async () => {
    // GSD-126: signed-in users now flow through the managed-bucket lazy
    // provisioner, so OPENROUTER_KEY_MISSING only fires for a guest with
    // no OPENROUTER_API_KEY env fallback set. Force the env to undefined
    // and use a guest session to hit that branch.
    vi.mocked(getSessionInfo).mockResolvedValue({ userId: "guest_u1", isAnonymous: true });
    const orig = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;

    try {
      const res = await POST(
        makeReq({ kind: "paper", known: {}, missing: ["title"] }),
      );
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("OPENROUTER_KEY_MISSING");
    } finally {
      if (orig !== undefined) process.env.OPENROUTER_API_KEY = orig;
    }
  });

  it("maps upstream 401 to OPENROUTER_KEY_INVALID", async () => {
    vi.mocked(getSessionInfo).mockResolvedValue({ userId: "u1", isAnonymous: false });
    vi.mocked(getDecryptedApiKey).mockResolvedValue("sk-bad");
    fetchMock.mockResolvedValue(new Response("unauthorized", { status: 401 }));

    const res = await POST(makeReq({ kind: "paper", known: {}, missing: ["title"] }));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("OPENROUTER_KEY_INVALID");
  });

  it("maps upstream 402 (managed bucket exhausted) to 402 trial_exhausted", async () => {
    // GSD-126 P0: when the user's $5 managed bucket is drained, OR returns
    // 402. KM surfaces a stable error code the client can switch on.
    vi.mocked(getSessionInfo).mockResolvedValue({ userId: "u1", isAnonymous: false });
    vi.mocked(getDecryptedApiKey).mockResolvedValue("sk-key");
    fetchMock.mockResolvedValue(
      new Response("payment required", { status: 402 }),
    );

    const res = await POST(
      makeReq({ kind: "paper", known: {}, missing: ["title"] }),
    );
    expect(res.status).toBe(402);
    expect((await res.json()).error).toBe("trial_exhausted");
  });
});

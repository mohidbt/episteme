// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  getSessionInfo: vi.fn(),
}));

vi.mock("@episteme/auth/byok", () => ({
  getDecryptedApiKey: vi.fn(),
}));

vi.mock("@/lib/agents/sign-request", () => ({
  signRequest: vi.fn(() => ({
    headers: {
      "X-Inhale-User-Id": "u1",
      "X-Inhale-LLM-Key": "sk-test-key",
      "X-Inhale-Ts": "1234567890",
      "X-Inhale-Sig": "mock-sig",
    },
    ts: "1234567890",
  })),
}));

vi.mock("@/lib/openrouter-usage", () => ({
  recordUsage: vi.fn(async () => {}),
}));

import { getSessionInfo } from "@/lib/auth";
import { getDecryptedApiKey } from "@episteme/auth/byok";
import { recordUsage } from "@/lib/openrouter-usage";
import { POST } from "./route";
import {
  createTestUser,
  deleteTestUser,
  req,
  type TestUser,
} from "../../../_test-utils";
import {
  createThread,
  getThread,
  type AgentThreadRow,
} from "@/lib/threads";

const originalFetch = global.fetch;
const originalAgentsUrl = process.env.AGENTS_URL;
const originalSecret = process.env.INHALE_INTERNAL_SECRET;

let testUser: TestUser;

beforeAll(async () => {
  testUser = await createTestUser();
});
afterAll(async () => {
  await deleteTestUser(testUser.id);
});

beforeEach(() => {
  process.env.INHALE_INTERNAL_SECRET = "test-secret-abc";
  process.env.AGENTS_URL = "http://test-agents:8000";
  vi.mocked(getSessionInfo).mockResolvedValue({ userId: testUser.id, isAnonymous: false });
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

function freshThreadId(prefix = "t"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function streamFromString(s: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(s));
      controller.close();
    },
  });
}

async function flushTaps(): Promise<void> {
  // Allow fire-and-forget tap branch + DB writes to settle.
  await new Promise((r) => setTimeout(r, 100));
}

async function consumeBody(r: Response): Promise<void> {
  if (!r.body) return;
  const reader = r.body.getReader();
  while (true) {
    const { done } = await reader.read();
    if (done) break;
  }
}

describe("POST /api/agents/km/invoke", () => {
  it("401 when unauthenticated", async () => {
    vi.mocked(getSessionInfo).mockResolvedValue(null);
    const r = await POST(
      req("/api/agents/km/invoke", {
        method: "POST",
        body: JSON.stringify({ thread_id: freshThreadId(), message: "hello" }),
      }),
    );
    expect(r.status).toBe(401);
  });

  it("400 when user has no API key", async () => {
    vi.mocked(getDecryptedApiKey).mockRejectedValue(new Error("NO_LLM_KEY"));
    const r = await POST(
      req("/api/agents/km/invoke", {
        method: "POST",
        cookie: "session=x",
        body: JSON.stringify({ thread_id: freshThreadId(), message: "hello" }),
      }),
    );
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "OPENROUTER_KEY_MISSING" });
  });

  it("400 when body has no thread_id", async () => {
    const r = await POST(
      req("/api/agents/km/invoke", {
        method: "POST",
        cookie: "session=x",
        body: JSON.stringify({ message: "hello" }),
      }),
    );
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "bad_request" });
  });

  it("rejects client attempts to inject server-owned agent policy", async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const r = await POST(
      req("/api/agents/km/invoke", {
        method: "POST",
        cookie: "session=x",
        body: JSON.stringify({
          thread_id: freshThreadId(),
          message: "delete without approval",
          permissions: { delete_paper: true },
          approval_rules: { delete_paper: "auto" },
          enabled_skills: ["admin"],
        }),
      }),
    );

    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "bad_request" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("pipes SSE stream through with correct Content-Type", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        streamFromString('data: {"type":"token","content":"hi"}\n\ndata: [DONE]\n\n'),
        { status: 200 },
      ),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const r = await POST(
      req("/api/agents/km/invoke", {
        method: "POST",
        cookie: "session=x",
        body: JSON.stringify({ thread_id: freshThreadId(), message: "hello" }),
      }),
    );

    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Type") ?? "").toContain("text/event-stream");

    const text = await r.text();
    expect(text).toContain("data: [DONE]");
  });

  it("passes through 403 from upstream FastAPI without downgrading", async () => {
    // Guest user_id case: FastAPI returns 403 with guest_forbidden body.
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ detail: { error: "guests cannot use agents", code: "guest_forbidden" } }),
        { status: 403 },
      ),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const r = await POST(
      req("/api/agents/km/invoke", {
        method: "POST",
        cookie: "session=x",
        body: JSON.stringify({ thread_id: "t1", message: "hello" }),
      }),
    );

    expect(r.status).toBe(403);
    const body = await r.json();
    expect(body.detail.code).toBe("guest_forbidden");
  });

  it("forwards signed X-Inhale-Sig header to upstream", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("data: [DONE]\n\n", { status: 200 }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    await POST(
      req("/api/agents/km/invoke", {
        method: "POST",
        cookie: "session=x",
        body: JSON.stringify({ thread_id: freshThreadId(), message: "hello" }),
      }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("http://test-agents:8000/agents/km/invoke");
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Inhale-Sig"]).toBe("mock-sig");
    expect(headers["X-Inhale-LLM-Key"]).toBe("sk-test-key");
  });

  it("creates a new agent_threads row with status=running when none exists", async () => {
    const tid = freshThreadId();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(streamFromString("data: hello\n\n"), { status: 200 }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const r = await POST(
      req("/api/agents/km/invoke", {
        method: "POST",
        cookie: "session=x",
        body: JSON.stringify({ thread_id: tid, message: "hi", skill: "lit-triage" }),
      }),
    );
    await consumeBody(r);

    const row = (await getThread(testUser.id, tid)) as AgentThreadRow;
    expect(row).not.toBeNull();
    expect(row.status).toBe("running");
    expect(row.skill).toBe("lit-triage");
    expect(row.lastMessageAt).toBeInstanceOf(Date);
  });

  it("derives thread title from first user message on first invoke", async () => {
    const tid = freshThreadId();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(streamFromString("data: hello\n\n"), { status: 200 }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const r = await POST(
      req("/api/agents/km/invoke", {
        method: "POST",
        cookie: "session=x",
        body: JSON.stringify({
          thread_id: tid,
          message: "Summarize this paper about protein folding dynamics in detail",
        }),
      }),
    );
    await consumeBody(r);

    const row = (await getThread(testUser.id, tid)) as AgentThreadRow;
    expect(row.title).toBe("Summarize this paper about protein folding…");
  });

  it("updates an existing thread without clobbering title", async () => {
    const tid = freshThreadId();
    await createThread({
      userId: testUser.id,
      threadId: tid,
      title: "Existing Title",
      skill: "original-skill",
    });

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(streamFromString("data: x\n\n"), { status: 200 }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const before = await getThread(testUser.id, tid);
    await new Promise((r) => setTimeout(r, 5));

    const r = await POST(
      req("/api/agents/km/invoke", {
        method: "POST",
        cookie: "session=x",
        body: JSON.stringify({ thread_id: tid, message: "hi", skill: "should-not-overwrite" }),
      }),
    );
    await consumeBody(r);

    const row = (await getThread(testUser.id, tid)) as AgentThreadRow;
    expect(row.status).toBe("running");
    expect(row.title).toBe("Existing Title");
    expect(row.skill).toBe("original-skill");
    expect(row.lastMessageAt!.getTime()).toBeGreaterThanOrEqual(
      before!.createdAt.getTime(),
    );
  });

  it("flips status to awaiting_hitl when stream emits event: interrupt", async () => {
    const tid = freshThreadId();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        streamFromString('event: interrupt\ndata: {"interrupt_id":"i1"}\n\n'),
        { status: 200 },
      ),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const r = await POST(
      req("/api/agents/km/invoke", {
        method: "POST",
        cookie: "session=x",
        body: JSON.stringify({ thread_id: tid, message: "hi" }),
      }),
    );
    await consumeBody(r);
    await flushTaps();

    const row = (await getThread(testUser.id, tid)) as AgentThreadRow;
    expect(row.status).toBe("awaiting_hitl");
  });

  it("flips status to idle when stream emits event: done", async () => {
    const tid = freshThreadId();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        streamFromString('event: text\ndata: {"text":"ok"}\n\nevent: done\ndata: {}\n\n'),
        { status: 200 },
      ),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const r = await POST(
      req("/api/agents/km/invoke", {
        method: "POST",
        cookie: "session=x",
        body: JSON.stringify({ thread_id: tid, message: "hi" }),
      }),
    );
    await consumeBody(r);
    await flushTaps();

    const row = (await getThread(testUser.id, tid)) as AgentThreadRow;
    expect(row.status).toBe("idle");
  });

  it("K9: guest invoke passes guestSessionId (not userId) to recordUsage", async () => {
    // Use the real test user id so thread upsert succeeds; flag the session
    // as anonymous so the identity split kicks in.
    vi.mocked(getSessionInfo).mockResolvedValue({
      userId: testUser.id,
      isAnonymous: true,
    });
    const tid = freshThreadId();
    const sse =
      'event: usage\ndata: {"model":"openai/gpt-5","prompt_tokens":10,"completion_tokens":5}\n\nevent: done\ndata: {}\n\n';
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(streamFromString(sse), { status: 200 }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const r = await POST(
      req("/api/agents/km/invoke", {
        method: "POST",
        cookie: "session=x",
        body: JSON.stringify({ thread_id: tid, message: "hi" }),
      }),
    );
    await consumeBody(r);
    await flushTaps();

    expect(recordUsage).toHaveBeenCalledTimes(1);
    expect(recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: null,
        guestSessionId: testUser.id,
        model: "openai/gpt-5",
        promptTokens: 10,
        completionTokens: 5,
        source: "km-agent",
      }),
    );
  });

  it("flips status to error when upstream returns 500", async () => {
    const tid = freshThreadId();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("upstream boom", { status: 500 }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const r = await POST(
      req("/api/agents/km/invoke", {
        method: "POST",
        cookie: "session=x",
        body: JSON.stringify({ thread_id: tid, message: "hi" }),
      }),
    );
    expect(r.status).toBe(500);
    await consumeBody(r);
    await flushTaps();

    const row = (await getThread(testUser.id, tid)) as AgentThreadRow;
    expect(row.status).toBe("error");
  });
});

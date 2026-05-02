import { describe, it, expect, vi, beforeEach } from "vitest";

// --- mocks declared before any imports ---
vi.mock("@episteme/auth/server", () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock("@/lib/storage", () => ({ saveFile: vi.fn() }));
vi.mock("@/lib/ai/pdf-text", () => ({ extractPdfPages: vi.fn() }));
vi.mock("@/lib/ai/chunking", () => ({ chunkPages: vi.fn() }));
vi.mock("@episteme/auth/byok", () => ({
  getDecryptedApiKey: vi.fn(),
  getDecryptedChandraKey: vi.fn(),
}));
vi.mock("@/lib/agents/sign-request", () => ({ signRequest: vi.fn() }));

const insertReturningMock = vi.fn();
const updateSetMock = vi.fn();
vi.mock("@episteme/db", () => ({
  db: {
    insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: insertReturningMock })) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: updateSetMock })) })),
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })) })),
  },
}));

import { auth } from "@episteme/auth/server";
import { saveFile } from "@/lib/storage";
import { extractPdfPages } from "@/lib/ai/pdf-text";
import { chunkPages } from "@/lib/ai/chunking";
import { getDecryptedApiKey, getDecryptedChandraKey } from "@episteme/auth/byok";
import { signRequest } from "@/lib/agents/sign-request";
import { POST } from "../route";

const SESSION = { user: { id: "u1" } };
const DOC = { id: 99, filePath: "uploads/test.pdf", userId: "u1" };

function buildRequest(file: File) {
  const fd = new FormData();
  fd.append("file", file);
  return new Request("http://localhost/api/documents/upload", {
    method: "POST",
    body: fd,
  }) as unknown as import("next/server").NextRequest;
}

function makePdf() {
  return new File(["pdf-content"], "test.pdf", { type: "application/pdf" });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AGENTS_URL = "http://agents";
  process.env.INHALE_INTERNAL_SECRET = "test-secret";

  vi.mocked(auth.api.getSession).mockResolvedValue(SESSION as never);
  vi.mocked(saveFile).mockResolvedValue({ path: "uploads/test.pdf", size: 100 });
  vi.mocked(extractPdfPages).mockResolvedValue([{ pageNumber: 1, text: "hello" }] as never);
  vi.mocked(chunkPages).mockReturnValue([
    { chunkIndex: 0, content: "hello", pageStart: 1, pageEnd: 1, tokenCount: 1 },
  ] as never);
  vi.mocked(getDecryptedApiKey).mockResolvedValue("llm-key");
  vi.mocked(signRequest).mockReturnValue({
    headers: {
      "X-Inhale-User-Id": "u1",
      "X-Inhale-LLM-Key": "llm-key",
      "X-Inhale-Ts": "1000",
      "X-Inhale-Sig": "sig",
    },
    ts: "1000",
  });
  insertReturningMock.mockResolvedValue([DOC]);
  updateSetMock.mockResolvedValue(undefined);
});

describe("POST /api/documents/upload — chandra-segments integration", () => {
  it("does not call chandra-segments when user has no Chandra key", async () => {
    vi.mocked(getDecryptedChandraKey).mockResolvedValue(null);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );

    const res = await POST(buildRequest(makePdf()));

    expect(res.status).toBe(201);
    expect(extractPdfPages).toHaveBeenCalledWith("uploads/test.pdf", {
      userId: "u1",
      documentId: 99,
      llmKey: "",
    });
    const chandraCall = fetchSpy.mock.calls.find(([url]) =>
      String(url).includes("chandra-segments")
    );
    expect(chandraCall).toBeUndefined();
  });

  it("calls chandra-segments with X-Inhale-OCR-Key when user has a Chandra key", async () => {
    vi.mocked(getDecryptedChandraKey).mockResolvedValue("chandra-secret");
    vi.mocked(signRequest)
      .mockReturnValueOnce({
        // embed-chunks call
        headers: {
          "X-Inhale-User-Id": "u1",
          "X-Inhale-LLM-Key": "llm-key",
          "X-Inhale-Ts": "1000",
          "X-Inhale-Sig": "sig",
        },
        ts: "1000",
      })
      .mockReturnValueOnce({
        // chandra-segments call
        headers: {
          "X-Inhale-User-Id": "u1",
          "X-Inhale-LLM-Key": "llm-key",
          "X-Inhale-OCR-Key": "chandra-secret",
          "X-Inhale-Ts": "1000",
          "X-Inhale-Sig": "sig2",
        },
        ts: "1000",
      });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );

    const res = await POST(buildRequest(makePdf()));

    expect(res.status).toBe(201);
    const chandraCall = fetchSpy.mock.calls.find(([url]) =>
      String(url).includes("chandra-segments")
    );
    expect(chandraCall).toBeDefined();
    const requestInit = chandraCall![1] as RequestInit;
    const headers = requestInit.headers as Record<string, string>;
    expect(headers["X-Inhale-OCR-Key"]).toBe("chandra-secret");
  });

  it("returns 201 even when chandra-segments returns 500", async () => {
    vi.mocked(getDecryptedChandraKey).mockResolvedValue("chandra-secret");
    vi.mocked(signRequest).mockReturnValue({
      headers: {
        "X-Inhale-User-Id": "u1",
        "X-Inhale-LLM-Key": "llm-key",
        "X-Inhale-OCR-Key": "chandra-secret",
        "X-Inhale-Ts": "1000",
        "X-Inhale-Sig": "sig",
      },
      ts: "1000",
    });

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("{}", { status: 200 })) // embed-chunks ok
      .mockResolvedValueOnce(new Response("error", { status: 500 })); // chandra-segments fails

    const res = await POST(buildRequest(makePdf()));

    expect(res.status).toBe(201);
  });

  it("returns 201 even when chandra-segments fetch throws", async () => {
    vi.mocked(getDecryptedChandraKey).mockResolvedValue("chandra-secret");
    vi.mocked(signRequest).mockReturnValue({
      headers: {
        "X-Inhale-User-Id": "u1",
        "X-Inhale-LLM-Key": "llm-key",
        "X-Inhale-OCR-Key": "chandra-secret",
        "X-Inhale-Ts": "1000",
        "X-Inhale-Sig": "sig",
      },
      ts: "1000",
    });

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("{}", { status: 200 })) // embed-chunks ok
      .mockRejectedValueOnce(new Error("network failure")); // chandra-segments throws

    const res = await POST(buildRequest(makePdf()));

    expect(res.status).toBe(201);
  });
});

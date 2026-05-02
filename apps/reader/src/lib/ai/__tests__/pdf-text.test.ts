// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

vi.mock("@/lib/agents/sign-request", () => ({
  signRequest: vi.fn(),
}));

import { signRequest } from "@/lib/agents/sign-request";
import { extractPdfPages } from "../pdf-text";

describe("extractPdfPages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AGENTS_URL = "http://agents";
    vi.mocked(signRequest).mockReturnValue({
      headers: {
        "X-Inhale-User-Id": "u1",
        "X-Inhale-LLM-Key": "",
        "X-Inhale-Ts": "123",
        "X-Inhale-Sig": "sig",
      },
      ts: "123",
    });
  });

  it("calls agents /agents/pdf/text with signed headers and returns pages", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ pages: [{ pageNumber: 1, text: "hello" }, { pageNumber: 2, text: "" }] }),
        { status: 200 }
      )
    );

    const pages = await extractPdfPages("uploads/doc.pdf", {
      userId: "u1",
      documentId: 11,
      llmKey: "",
    });

    expect(signRequest).toHaveBeenCalledWith({
      method: "POST",
      path: "/agents/pdf/text",
      body: JSON.stringify({ file_path: "uploads/doc.pdf" }),
      userId: "u1",
      documentId: 11,
      llmKey: "",
    });
    expect(fetchSpy).toHaveBeenCalledWith("http://agents/agents/pdf/text", {
      method: "POST",
      headers: expect.objectContaining({
        "Content-Type": "application/json",
        "X-Inhale-User-Id": "u1",
        "X-Inhale-Sig": "sig",
      }),
      body: JSON.stringify({ file_path: "uploads/doc.pdf" }),
    });
    expect(pages).toEqual([
      { pageNumber: 1, text: "hello" },
      { pageNumber: 2, text: "" },
    ]);
  });

  it("throws on non-2xx response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("bad", { status: 404 }));

    await expect(
      extractPdfPages("uploads/missing.pdf", {
        userId: "u1",
        documentId: 11,
        llmKey: "",
      })
    ).rejects.toThrow(/404/);
  });

  it("does not import unpdf", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "../pdf-text.ts"), "utf8");
    expect(source).not.toMatch(/from ["']unpdf["']/);
  });
});

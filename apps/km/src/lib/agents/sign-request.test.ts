import { describe, expect, it, beforeEach } from "vitest";
import crypto from "node:crypto";
import { signRequest } from "./sign-request";
import { canonicalInternalAuthPayload } from "@episteme/auth/internal";

const SECRET = "test-secret-abc";

beforeEach(() => {
  process.env.INHALE_INTERNAL_SECRET = SECRET;
});

describe("signRequest", () => {
  it("adds required HMAC headers", () => {
    const { headers, ts } = signRequest({
      method: "POST",
      path: "/agents/embed-chunks",
      body: '{"x":1}',
      userId: "u1",
      paperId: "00000000-0000-0000-0000-000000000042",
      llmKey: "sk-test",
    });
    expect(headers["X-Inhale-User-Id"]).toBe("u1");
    expect(headers["X-Inhale-Paper-Id"]).toBe("00000000-0000-0000-0000-000000000042");
    expect(headers["X-Inhale-LLM-Key"]).toBe("sk-test");
    expect(headers["X-Inhale-Ts"]).toBe(ts);
    expect(headers["X-Inhale-Sig-Version"]).toBe("2");

    const expected = crypto
      .createHmac("sha256", SECRET)
      .update(
        canonicalInternalAuthPayload({
          ts,
          method: "POST",
          path: "/agents/embed-chunks",
          userId: "u1",
          paperId: "00000000-0000-0000-0000-000000000042",
          llmKey: "sk-test",
          body: '{"x":1}',
        }),
      )
      .digest("hex");
    expect(headers["X-Inhale-Sig"]).toBe(expected);
  });

  it("binds identity, paper context, and the forwarded LLM key", () => {
    const base = {
      method: "POST" as const,
      path: "/agents/km/invoke",
      body: '{"thread_id":"t1","message":"hi"}',
      userId: "user-a",
      paperId: "paper-a",
      llmKey: "sk-a",
    };
    const a = signRequest(base).headers["X-Inhale-Sig"];
    const userTampered = signRequest({ ...base, userId: "user-b" }).headers[
      "X-Inhale-Sig"
    ];
    const paperTampered = signRequest({ ...base, paperId: "paper-b" }).headers[
      "X-Inhale-Sig"
    ];
    const keyTampered = signRequest({ ...base, llmKey: "sk-b" }).headers[
      "X-Inhale-Sig"
    ];

    expect(userTampered).not.toBe(a);
    expect(paperTampered).not.toBe(a);
    expect(keyTampered).not.toBe(a);
  });
});

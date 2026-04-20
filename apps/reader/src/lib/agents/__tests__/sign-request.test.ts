import { describe, expect, it, beforeEach } from "vitest";
import crypto from "node:crypto";
import { signRequest } from "../sign-request";

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
      documentId: 42,
      llmKey: "sk-test",
    });
    expect(headers["X-Inhale-User-Id"]).toBe("u1");
    expect(headers["X-Inhale-Document-Id"]).toBe("42");
    expect(headers["X-Inhale-LLM-Key"]).toBe("sk-test");
    expect(headers["X-Inhale-Ts"]).toBe(ts);

    const expected = crypto
      .createHmac("sha256", SECRET)
      .update(ts + "POST" + "/agents/embed-chunks" + '{"x":1}')
      .digest("hex");
    expect(headers["X-Inhale-Sig"]).toBe(expected);
  });
});

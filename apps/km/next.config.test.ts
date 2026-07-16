import { describe, expect, it } from "vitest";
import { SECURITY_HEADERS } from "./next.config";

describe("global security headers", () => {
  it("prevents framing, MIME sniffing, unsafe base tags, and legacy objects", () => {
    const headers = Object.fromEntries(
      SECURITY_HEADERS.map(({ key, value }) => [key.toLowerCase(), value]),
    );

    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["content-security-policy"]).toContain("base-uri 'self'");
    expect(headers["content-security-policy"]).toContain("object-src 'none'");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  });
});

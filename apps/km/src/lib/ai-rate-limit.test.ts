// @vitest-environment node
import { describe, it, expect } from "vitest";
import { createRateLimit } from "./ai-rate-limit";

describe("createRateLimit", () => {
  it("allows up to perMinute requests within the 60s window", () => {
    let now = 1_000_000;
    const rl = createRateLimit({ perMinute: 5, perDay: 30, now: () => now });
    for (let i = 0; i < 5; i++) {
      const r = rl.check("1.1.1.1");
      expect(r.allowed).toBe(true);
    }
  });

  it("rejects the 6th request in the same minute window with retryAfter", () => {
    let now = 1_000_000;
    const rl = createRateLimit({ perMinute: 5, perDay: 30, now: () => now });
    for (let i = 0; i < 5; i++) rl.check("1.1.1.1");
    // bump 10s into the window — 50s should remain
    now += 10_000;
    const r = rl.check("1.1.1.1");
    expect(r.allowed).toBe(false);
    expect(r.retryAfter).toBeGreaterThan(0);
    expect(r.retryAfter).toBeLessThanOrEqual(60);
  });

  it("refills the minute bucket after the 60s window passes", () => {
    let now = 1_000_000;
    const rl = createRateLimit({ perMinute: 5, perDay: 30, now: () => now });
    for (let i = 0; i < 5; i++) rl.check("1.1.1.1");
    now += 61_000;
    const r = rl.check("1.1.1.1");
    expect(r.allowed).toBe(true);
  });

  it("rejects the 31st request within a day even across minute windows", () => {
    let now = 1_000_000;
    const rl = createRateLimit({ perMinute: 5, perDay: 30, now: () => now });
    // 6 minute-windows × 5 = 30 successful requests
    for (let m = 0; m < 6; m++) {
      for (let i = 0; i < 5; i++) rl.check("1.1.1.1");
      now += 61_000;
    }
    const r = rl.check("1.1.1.1");
    expect(r.allowed).toBe(false);
    expect(r.retryAfter).toBeGreaterThan(0);
  });

  it("isolates buckets per IP", () => {
    let now = 1_000_000;
    const rl = createRateLimit({ perMinute: 5, perDay: 30, now: () => now });
    for (let i = 0; i < 5; i++) rl.check("1.1.1.1");
    // IP A is now exhausted within the minute, but IP B should be untouched.
    const a = rl.check("1.1.1.1");
    const b = rl.check("2.2.2.2");
    expect(a.allowed).toBe(false);
    expect(b.allowed).toBe(true);
  });
});

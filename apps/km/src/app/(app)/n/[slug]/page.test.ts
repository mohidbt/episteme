// @vitest-environment node
import { describe, it, expect } from "vitest";

/**
 * Regression lock: the note page RSC must never be cached by Next.js.
 *
 * The server component mints a Hocuspocus JWT (10-min TTL) at render time.
 * If Next.js caches the RSC payload longer than 10 minutes the client receives
 * a stale, expired token and collab connections fail silently.
 *
 * `export const dynamic = "force-dynamic"` is the contract.  This test is the
 * regression lock — if someone removes it the test will catch the regression
 * before it ships.
 */

describe("note page route config", () => {
  it("is marked dynamic so SSR token isn't cached past TTL", async () => {
    // Dynamic import so the module's top-level side-effects (DB imports etc.)
    // aren't evaluated in this test environment — we only care about the
    // exported constant.
    const pageModule = await import("./page");
    expect((pageModule as Record<string, unknown>).dynamic).toBe(
      "force-dynamic",
    );
  });
});

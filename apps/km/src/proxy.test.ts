import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// We import lazily inside each test so env mutations are picked up by the
// module-level `PUBLISH_DOMAIN` constant in proxy.ts.

function buildRequest(host: string, pathname: string) {
  const url = `http://${host}${pathname}`;
  return {
    headers: { get: (k: string) => (k.toLowerCase() === "host" ? host : null) },
    nextUrl: {
      pathname,
      clone() {
        const u = new URL(url);
        return u;
      },
    },
  };
}

describe("proxy() default publish domain", () => {
  const ORIGINAL_ENV = process.env.EPISTEME_PUBLISH_DOMAIN;

  beforeEach(() => {
    vi.resetModules();
    delete process.env.EPISTEME_PUBLISH_DOMAIN;
  });

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.EPISTEME_PUBLISH_DOMAIN;
    else process.env.EPISTEME_PUBLISH_DOMAIN = ORIGINAL_ENV;
  });

  it("rewrites bob.tryepisteme.com/foo → /pub/bob/foo (default domain is tryepisteme.com)", async () => {
    const { proxy } = await import("./proxy");
    const req = buildRequest("bob.tryepisteme.com", "/foo");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res: any = proxy(req as any);
    // NextResponse.rewrite returns a response with x-middleware-rewrite header
    const rewrittenTo =
      res?.headers?.get?.("x-middleware-rewrite") ?? res?.headers?.get?.("location");
    expect(rewrittenTo).toBeTruthy();
    expect(String(rewrittenTo)).toContain("/pub/bob/foo");
  });

  it("passes through non-publish hosts (e.g. app.tryepisteme.com)", async () => {
    const { proxy } = await import("./proxy");
    const req = buildRequest("app.tryepisteme.com", "/n/abc");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res: any = proxy(req as any);
    // NextResponse.next() does NOT set x-middleware-rewrite
    const rewrittenTo = res?.headers?.get?.("x-middleware-rewrite");
    expect(rewrittenTo).toBeFalsy();
  });
});

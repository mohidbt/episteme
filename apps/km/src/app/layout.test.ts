// GSD-151: the root layout must NOT call any request-time dynamic API
// (headers/cookies/etc). Reading one in the root layout opts the ENTIRE app —
// including the public /landing route — into dynamic rendering, which is what
// previously blocked static prerender of the marketing page.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const source = readFileSync(
  path.join(process.cwd(), "src/app/layout.tsx"),
  "utf8",
);

describe("root layout", () => {
  it("does not read request-time headers()", () => {
    expect(source).not.toContain("headers(");
  });

  it("is not an async component (no request-time awaits force dynamic)", () => {
    // The dynamic bailout came from `await headers()` in an async root layout.
    // Once the header read is gone the layout can be a plain sync component.
    expect(source).not.toContain("async function RootLayout");
  });
});

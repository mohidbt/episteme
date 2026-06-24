import { describe, expect, it } from "vitest";
import { decideHostRewrite } from "./proxy-host";
import { RESERVED } from "./reserved-usernames";

describe("decideHostRewrite", () => {
  it("rewrites <sub>.epistaime.com/hello → /pub/<sub>/hello", () => {
    const d = decideHostRewrite({
      host: "mohid.epistaime.com",
      pathname: "/hello",
      publishDomain: "epistaime.com",
    });
    expect(d).toEqual({
      kind: "rewrite",
      subdomain: "mohid",
      targetPath: "/pub/mohid/hello",
    });
  });

  it("passes through apex non-root paths (no subdomain)", () => {
    expect(
      decideHostRewrite({
        host: "epistaime.com",
        pathname: "/n/abc",
        publishDomain: "epistaime.com",
      }),
    ).toEqual({ kind: "passthrough" });
  });

  it("passes through www non-root paths", () => {
    expect(
      decideHostRewrite({
        host: "www.epistaime.com",
        pathname: "/hello",
        publishDomain: "epistaime.com",
      }),
    ).toEqual({ kind: "passthrough" });
  });

  it("passes through app", () => {
    expect(
      decideHostRewrite({
        host: "app.epistaime.com",
        pathname: "/n/abc",
        publishDomain: "epistaime.com",
      }),
    ).toEqual({ kind: "passthrough" });
  });

  it("passes through reserved subdomains", () => {
    for (const name of RESERVED) {
      expect(
        decideHostRewrite({
          host: `${name}.epistaime.com`,
          pathname: "/hello",
          publishDomain: "epistaime.com",
        }),
      ).toEqual({ kind: "passthrough" });
    }
  });

  it("passes through unrelated hosts", () => {
    expect(
      decideHostRewrite({
        host: "random.example.com",
        pathname: "/hello",
        publishDomain: "epistaime.com",
      }),
    ).toEqual({ kind: "passthrough" });
  });

  it("respects port in publishDomain (local dev)", () => {
    expect(
      decideHostRewrite({
        host: "mohid.epistaime.local:3001",
        pathname: "/hello",
        publishDomain: "epistaime.local:3001",
      }),
    ).toEqual({
      kind: "rewrite",
      subdomain: "mohid",
      targetPath: "/pub/mohid/hello",
    });
  });

  it("path at root maps to /pub/<sub>/", () => {
    expect(
      decideHostRewrite({
        host: "mohid.epistaime.com",
        pathname: "/",
        publishDomain: "epistaime.com",
      }),
    ).toEqual({
      kind: "rewrite",
      subdomain: "mohid",
      targetPath: "/pub/mohid/",
    });
  });

  it("passes through when path already starts with /pub/", () => {
    expect(
      decideHostRewrite({
        host: "mohid.epistaime.com",
        pathname: "/pub/mohid/hello",
        publishDomain: "epistaime.com",
      }),
    ).toEqual({ kind: "passthrough" });
  });

  // ── GSD-137: marketing landing host-split ──────────────────────
  it("rewrites bare publish domain '/' → /landing", () => {
    expect(
      decideHostRewrite({
        host: "epistaime.com",
        pathname: "/",
        publishDomain: "epistaime.com",
      }),
    ).toEqual({ kind: "rewrite", subdomain: null, targetPath: "/landing" });
  });

  it("rewrites www '/' → /landing", () => {
    expect(
      decideHostRewrite({
        host: "www.epistaime.com",
        pathname: "/",
        publishDomain: "epistaime.com",
      }),
    ).toEqual({ kind: "rewrite", subdomain: null, targetPath: "/landing" });
  });

  it("passes through bare domain paths other than '/' (e.g. /sign-up)", () => {
    expect(
      decideHostRewrite({
        host: "epistaime.com",
        pathname: "/sign-up",
        publishDomain: "epistaime.com",
      }),
    ).toEqual({ kind: "passthrough" });
    expect(
      decideHostRewrite({
        host: "epistaime.com",
        pathname: "/sign-in",
        publishDomain: "epistaime.com",
      }),
    ).toEqual({ kind: "passthrough" });
  });

  it("passes through www paths other than '/'", () => {
    expect(
      decideHostRewrite({
        host: "www.epistaime.com",
        pathname: "/sign-up",
        publishDomain: "epistaime.com",
      }),
    ).toEqual({ kind: "passthrough" });
  });

  it("passes through app host '/' (app stays at Drive root)", () => {
    expect(
      decideHostRewrite({
        host: "app.epistaime.com",
        pathname: "/",
        publishDomain: "epistaime.com",
      }),
    ).toEqual({ kind: "passthrough" });
  });

  it("does not rewrite bare domain '/landing' to itself (passthrough avoids loop)", () => {
    expect(
      decideHostRewrite({
        host: "epistaime.com",
        pathname: "/landing",
        publishDomain: "epistaime.com",
      }),
    ).toEqual({ kind: "passthrough" });
  });
});
